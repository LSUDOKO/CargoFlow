// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CargoFlowAccess} from "../../src/access/CargoFlowAccess.sol";
import {Controlled} from "../../src/access/Controlled.sol";
import {DeviceRegistry} from "../../src/DeviceRegistry.sol";
import {IDeviceRegistry} from "../../src/interfaces/IDeviceRegistry.sol";
import {Roles} from "../../src/libraries/Roles.sol";

contract DeviceRegistryTest is Test {
    CargoFlowAccess internal access;
    DeviceRegistry internal devices;

    address internal admin = makeAddr("admin");
    address internal attestor = makeAddr("attestor");
    address internal operator = makeAddr("operator");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant KEY = keccak256("gateway-p256-pubkey");
    bytes32 internal constant ATTESTATION = keccak256("x509-chain");

    event DeviceRegistered(
        bytes32 indexed deviceKeyHash,
        address indexed owner,
        uint8 indexed deviceClass,
        bytes32 attestationHash,
        address registeredBy
    );
    event DeviceRevoked(bytes32 indexed deviceKeyHash, address indexed revokedBy, bytes32 reason);

    function setUp() public {
        vm.warp(1_800_000_000);
        access = new CargoFlowAccess(0, admin);
        devices = new DeviceRegistry(address(access));
        vm.prank(admin);
        access.grantRole(Roles.ATTESTOR_ROLE, attestor);
    }

    function test_constructorRejectsZeroAccess() public {
        vm.expectRevert(Controlled.ZeroAddress.selector);
        new DeviceRegistry(address(0));
    }

    function test_attestorRegistersSecureElementForOperator() public {
        vm.expectEmit(address(devices));
        emit DeviceRegistered(KEY, operator, 2, ATTESTATION, attestor);
        vm.prank(attestor);
        devices.registerDevice(KEY, 2, ATTESTATION, operator);

        IDeviceRegistry.Device memory d = devices.getDevice(KEY);
        assertEq(d.owner, operator);
        assertEq(d.deviceClass, 2);
        assertEq(d.attestationHash, ATTESTATION);
        assertEq(d.registeredBy, attestor);
        assertEq(d.registeredAt, block.timestamp);
        assertFalse(d.revoked);
        assertTrue(devices.isActive(KEY));
        (uint8 cls, bool active) = devices.deviceClassOf(KEY);
        assertEq(cls, 2);
        assertTrue(active);
        assertEq(devices.deviceCount(), 1);
    }

    function test_attestorRegistersPasskey() public {
        vm.prank(attestor);
        devices.registerDevice(KEY, 1, ATTESTATION, operator);
        assertEq(devices.getDevice(KEY).deviceClass, 1);
    }

    function test_hardwareClassRequiresAttestationHash() public {
        vm.prank(attestor);
        vm.expectRevert(IDeviceRegistry.AttestationRequired.selector);
        devices.registerDevice(KEY, 1, bytes32(0), operator);
        vm.prank(attestor);
        vm.expectRevert(IDeviceRegistry.AttestationRequired.selector);
        devices.registerDevice(KEY, 2, bytes32(0), operator);
    }

    function test_attestorMaySoftwareRegisterWithoutAttestation() public {
        vm.prank(attestor);
        devices.registerDevice(KEY, 0, bytes32(0), operator);
        assertEq(devices.getDevice(KEY).owner, operator);
    }

    function test_ownerSelfRegistersSoftwareDevice() public {
        vm.prank(operator);
        devices.registerDevice(KEY, 0, bytes32(0), operator);
        IDeviceRegistry.Device memory d = devices.getDevice(KEY);
        assertEq(d.registeredBy, operator);
        assertEq(d.deviceClass, 0);
    }

    function test_nonAttestorCannotRegisterHardwareClass() public {
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(Controlled.Unauthorized.selector, Roles.ATTESTOR_ROLE, operator)
        );
        devices.registerDevice(KEY, 2, ATTESTATION, operator);
    }

    function test_nonAttestorCannotRegisterForSomeoneElse() public {
        vm.prank(stranger);
        vm.expectRevert(IDeviceRegistry.NotDeviceOwnerOrAttestor.selector);
        devices.registerDevice(KEY, 0, bytes32(0), operator);
    }

    function test_rejectsInvalidInputs() public {
        vm.startPrank(attestor);
        vm.expectRevert(IDeviceRegistry.InvalidDevice.selector);
        devices.registerDevice(bytes32(0), 0, bytes32(0), operator);
        vm.expectRevert(IDeviceRegistry.InvalidDevice.selector);
        devices.registerDevice(KEY, 0, bytes32(0), address(0));
        vm.expectRevert(IDeviceRegistry.InvalidDevice.selector);
        devices.registerDevice(KEY, 3, ATTESTATION, operator);
        vm.stopPrank();
    }

    function test_writeOnceEvenAfterRevocation() public {
        vm.prank(attestor);
        devices.registerDevice(KEY, 2, ATTESTATION, operator);
        vm.prank(attestor);
        vm.expectRevert(IDeviceRegistry.DeviceAlreadyRegistered.selector);
        devices.registerDevice(KEY, 1, ATTESTATION, stranger);

        vm.prank(operator);
        devices.revokeDevice(KEY, "lost");
        vm.prank(attestor);
        vm.expectRevert(IDeviceRegistry.DeviceAlreadyRegistered.selector);
        devices.registerDevice(KEY, 2, ATTESTATION, operator);
    }

    function test_ownerRevokes() public {
        vm.prank(attestor);
        devices.registerDevice(KEY, 2, ATTESTATION, operator);
        vm.warp(block.timestamp + 100);
        vm.expectEmit(address(devices));
        emit DeviceRevoked(KEY, operator, "tampered");
        vm.prank(operator);
        devices.revokeDevice(KEY, "tampered");

        IDeviceRegistry.Device memory d = devices.getDevice(KEY);
        assertTrue(d.revoked);
        assertEq(d.revokedAt, block.timestamp);
        assertFalse(devices.isActive(KEY));
        (, bool active) = devices.deviceClassOf(KEY);
        assertFalse(active);
    }

    function test_attestorRevokes() public {
        vm.prank(operator);
        devices.registerDevice(KEY, 0, bytes32(0), operator);
        vm.prank(attestor);
        devices.revokeDevice(KEY, "key-compromise");
        assertFalse(devices.isActive(KEY));
    }

    function test_strangerCannotRevoke() public {
        vm.prank(attestor);
        devices.registerDevice(KEY, 2, ATTESTATION, operator);
        vm.prank(stranger);
        vm.expectRevert(IDeviceRegistry.NotDeviceOwnerOrAttestor.selector);
        devices.revokeDevice(KEY, "x");
    }

    function test_cannotRevokeTwiceOrUnknown() public {
        vm.prank(attestor);
        vm.expectRevert(IDeviceRegistry.DeviceNotFound.selector);
        devices.revokeDevice(KEY, "x");

        vm.prank(attestor);
        devices.registerDevice(KEY, 2, ATTESTATION, operator);
        vm.prank(operator);
        devices.revokeDevice(KEY, "x");
        vm.prank(operator);
        vm.expectRevert(IDeviceRegistry.DeviceAlreadyRevoked.selector);
        devices.revokeDevice(KEY, "x");
    }

    function test_unknownDeviceViews() public {
        assertFalse(devices.isActive(KEY));
        vm.expectRevert(IDeviceRegistry.DeviceNotFound.selector);
        devices.getDevice(KEY);
        vm.expectRevert(IDeviceRegistry.DeviceNotFound.selector);
        devices.deviceClassOf(KEY);
    }

    function testFuzz_registrationRules(
        bytes32 key,
        uint8 cls,
        bytes32 attestation,
        address owner,
        bool asAttestor
    ) public {
        vm.assume(key != 0 && owner != address(0) && owner != attestor);
        address caller = asAttestor ? attestor : owner;
        bool ok = cls <= 2
            && (asAttestor ? (cls == 0 || attestation != 0) : (cls == 0 && caller == owner));
        vm.prank(caller);
        if (!ok) vm.expectRevert();
        devices.registerDevice(key, cls, attestation, owner);
        assertEq(devices.isActive(key), ok);
        assertEq(devices.deviceCount(), ok ? 1 : 0);
    }
}
