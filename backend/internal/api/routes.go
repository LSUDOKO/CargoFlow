package api

import (
	"net/http"

	"github.com/LSUDOKO/CargoFlow/backend/internal/pricing"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// Tags group operations in the reference.
const (
	tagSystem    = "System"
	tagShipments = "Shipments"
	tagEvidence  = "Evidence"
	tagDevices   = "Devices"
	tagRecovery  = "Recovery"
	tagDocuments = "Documents"
	tagAlerts    = "Alerts"
	tagMarket    = "Marketplace"
	tagParties   = "Parties"
	tagStandards = "Standards"
	tagAdmin     = "Admin"
)

var (
	shipmentStatusQuery = []param{
		{Name: "party", Description: "only shipments where this 0x address is exporter, buyer or financier"},
		{Name: "ref", Description: "external reference (exact)"},
		{Name: "status", Description: "comma-separated statuses, e.g. PAUSED,DISPUTED"},
		{Name: "limit", Description: "1 to 200 (default 50)", Schema: map[string]any{"type": "integer", "minimum": 1, "maximum": 200}},
		{Name: "offset", Description: "rows to skip", Schema: map[string]any{"type": "integer", "minimum": 0}},
	}
	addressQuery = []param{{Name: "address", Description: "a 0x address", Required: true}}
)

// routes is the API's route table: Handler serves exactly these, and the OpenAPI document is generated from them.
func (s *Server) routes() []route {
	return []route{
		// System
		{Method: "GET", Path: "/v1/health", ID: "getHealth", Tag: tagSystem, Summary: "Database and chain reachability",
			Description: "503 with status `degraded` when the database or the RPC cannot be reached. `rpc` says whether the primary or the fallback RPC is serving.",
			Response:    healthResponse{}, h: s.health},
		{Method: "GET", Path: "/v1/config", ID: "getConfig", Tag: tagSystem, Summary: "Chain id, contract addresses and enabled integrations",
			Response: configResponse{}, h: s.config},
		{Method: "GET", Path: "/v1/stats", ID: "getStats", Tag: tagSystem, Summary: "Shipments by status, committed epochs and verified proofs",
			Response: store.Stats{}, h: s.stats},
		{Method: "GET", Path: "/v1/openapi.json", ID: "getOpenAPI", Tag: tagSystem, Summary: "This OpenAPI 3.1 document",
			Response: map[string]any{}, h: s.openapi},
		{Method: "GET", Path: "/v1/ws", ID: "streamEvents", Tag: tagSystem, Summary: "WebSocket event stream",
			Description: "Upgrade to a WebSocket. `?shipment=0x..` filters to one shipment. Events: TELEMETRY_EPOCH_ADDED, EVIDENCE_UPDATED, " +
				"RISK_UPDATED, SHIPMENT_UPDATED, MILESTONE_RELEASED, FINANCING_PAUSED, PROOF_VERIFIED, FINANCING_RESUMED, DELIVERY_CONFIRMED, " +
				"FACILITY_SETTLED, COVER_UPDATED, MILESTONE_HELD, RECOVERY_READY, each with a hub-assigned `seq`. A slow client is closed with 1013.",
			Query:  []param{{Name: "shipment", Description: "only this shipment's events"}},
			Status: http.StatusSwitchingProtocols, raw: func(s *Server) http.Handler { return s.wsHandler() }},

		// Shipments
		{Method: "GET", Path: "/v1/shipments", ID: "listShipments", Tag: tagShipments, Summary: "List mirrored shipments",
			Query: shipmentStatusQuery, Response: shipmentList{}, h: s.listShipments},
		{Method: "POST", Path: "/v1/shipments", ID: "createShipment", Tag: tagAdmin, Auth: authAdmin, Summary: "Mirror an on-chain shipment (operator)",
			Description: "Parties, invoice, commitments, policy and milestone places are read from the chain; the request is refused unless the reference, route and policy match their on-chain commitments.",
			Request:     shipmentRequest{}, Response: store.Shipment{}, Status: http.StatusCreated, h: s.admin(s.createShipment)},
		{Method: "POST", Path: "/v1/shipments/mirror", ID: "mirrorShipment", Tag: tagShipments, Summary: "Mirror an on-chain shipment (public, 30/min per client)",
			Description: "Safe without credentials: nothing the chain does not confirm is stored. A repeat answers 200 with the existing record; `placeLabels` fill in once.",
			Request:     shipmentRequest{}, Response: store.Shipment{}, Status: http.StatusCreated, Also: map[int]string{200: "already mirrored"}, h: s.mirror},
		{Method: "GET", Path: "/v1/shipments/{id}", ID: "getShipment", Tag: tagShipments, Summary: "Combined store and live chain view of a shipment",
			Response: service.ShipmentView{}, h: s.getShipment},
		{Method: "GET", Path: "/v1/shipments/{id}/explanation", ID: "explainShipment", Tag: tagShipments, Summary: "Why the shipment is where it is, and who can move it on",
			Response: service.Explanation{}, h: s.explanation},
		{Method: "GET", Path: "/v1/shipments/{id}/audit", ID: "getAudit", Tag: tagShipments, Summary: "Time-ordered trail of chain events, decisions, epochs and transactions",
			Query: []param{{Name: "limit", Description: "1 to 2000 (default 500)", Schema: map[string]any{"type": "integer"}}}, Response: auditList{}, h: s.audit},
		{Method: "GET", Path: "/v1/shipments/{id}/cover", ID: "getCover", Tag: tagShipments, Summary: "Default cover: open offers and the accepted cover",
			Response: store.ShipmentCover{}, h: s.cover},
		{Method: "POST", Path: "/v1/shipments/{id}/vessel", ID: "setVessel", Tag: tagShipments, Auth: authWallet, Summary: "Name the vessel (exporter)",
			Signed:  "CargoFlow vessel\nshipment: <id>\nmmsi: <mmsi>\nissued: <t>",
			Request: vesselRequest{}, Response: vesselDTO{}, Status: http.StatusCreated, Also: map[int]string{200: "replaced the named vessel"}, h: s.setVessel},
		{Method: "GET", Path: "/v1/shipments/{id}/vessel", ID: "getVessel", Tag: tagShipments, Summary: "The vessel, its AIS track and the logger cross-check",
			Response: vesselDTO{}, h: s.getVessel},

		// Evidence
		{Method: "POST", Path: "/v1/shipments/{id}/telemetry", ID: "submitTelemetry", Tag: tagEvidence, Auth: authSource, Summary: "Submit signed readings",
			Description: "Up to 500 readings per request, none dated more than 5 minutes ahead; at most 20,000 readings an hour per shipment. " +
				"Readings are idempotent on (shipment, sensor, timestamp).",
			Request: telemetryRequest{}, Response: service.IngestResult{}, h: s.telemetry},
		{Method: "GET", Path: "/v1/shipments/{id}/telemetry", ID: "getTelemetrySummary", Tag: tagEvidence, Summary: "Per-epoch, per-sensor temperature aggregates (never raw readings)",
			Response: service.TelemetrySummary{}, h: s.telemetrySummary},
		{Method: "GET", Path: "/v1/shipments/{id}/epochs", ID: "listEpochs", Tag: tagEvidence, Summary: "Evidence epochs: scores, roots and committed aggregates",
			Response: epochList{}, h: s.epochs},
		{Method: "GET", Path: "/v1/shipments/{id}/track", ID: "getTrack", Tag: tagEvidence, Summary: "One centroid per epoch, oldest first",
			Response: trackResponse{}, h: s.track},

		// Standards
		{Method: "GET", Path: "/v1/shipments/{id}/epcis", ID: "exportEPCIS", Tag: tagStandards, Summary: "The shipment as a GS1 EPCIS 2.0 JSON-LD document",
			Description: "ObjectEvents: commissioning, shipping, one sensor_reporting event per evidence epoch (sensorElementList with per-sensor " +
				"min/max/mean temperature in CEL, max/mean relative humidity in P1 and peak acceleration in MSK; readPoint = the epoch centroid " +
				"as a geo: URI), receiving, and financing events with bizSteps and fields in the CargoFlow namespace (https://cargoflow.app/epcis/). " +
				"Validates against the official EPCIS 2.0 JSON schema.",
			Response: epcisDocDoc{}, ContentType: "application/ld+json", h: s.epcisExport},
		{Method: "POST", Path: "/v1/shipments/{id}/epcis", ID: "captureEPCIS", Tag: tagStandards, Auth: authSource, Summary: "Import sensor ObjectEvents as readings",
			Description: "An EPCISDocument (or one ObjectEvent). Every ObjectEvent with a sensorElementList gives one reading per element: time " +
				"from the report, the metadata or eventTime; sensor = last segment of deviceID; position = readPoint geo: URI (required); " +
				"Temperature (CEL/FAH/KEL) required, RelativeHumidity (P1) and Acceleration (MSK, or K40 for g) optional. Same limits and sensor " +
				"binding as telemetry.",
			Request: epcisDocDoc{}, Response: service.IngestResult{}, h: s.epcisCapture},

		// Devices
		{Method: "POST", Path: "/v1/shipments/{id}/sources", ID: "registerGateway", Tag: tagDevices, Auth: authWallet, Summary: "Register an evidence gateway (exporter)",
			Description: "Binds a device key to this shipment. `keyType` is `ed25519` (default), `p256` or `webauthn`. A `p256` key with an X.509 " +
				"`attestation` chain that verifies to a manufacturer root (DEVICE_ROOTS_DIR) is class `secure_element`; a `webauthn` key needs " +
				"its attestation object (`packed` or `none`) and clientDataJSON (type `webauthn.create`, challenge = sha256(\"CARGOFLOW-V1-REGISTER\\n\" + shipment id)) and is class `passkey`; " +
				"anything else is `software`. A repeat with the same sensors answers 200; the same key with other sensors is 409; at most 8 per shipment.",
			Signed:  "CargoFlow evidence source\nshipment: <id>\npublic key: <publicKey as sent>\nsensors: <a,b>\n[key type: <p256|webauthn>  (only for non-ed25519 keys)]\nissued: <t>",
			Request: gatewayRequest{}, Response: sourceDTO{}, Status: http.StatusCreated, Also: map[int]string{200: "already registered"}, h: s.registerGateway},
		{Method: "GET", Path: "/v1/shipments/{id}/sources", ID: "listGateways", Tag: tagDevices, Summary: "The shipment's evidence gateways with their device class",
			Response: sourceList{}, h: s.listGateways},
		{Method: "GET", Path: "/v1/devices/{keyHash}", ID: "getDevice", Tag: tagDevices, Summary: "A device key: class, attestation and the source it feeds",
			Description: "`onChain` is the contracts v3 DeviceRegistry record when that contract is deployed, else null.",
			Response:    deviceDTO{}, h: s.device},
		{Method: "POST", Path: "/v1/sources", ID: "createSource", Tag: tagAdmin, Auth: authAdmin, Summary: "Register an unbound evidence source (operator)",
			Request: sourceRequest{}, Response: sourceCreated{}, Status: http.StatusCreated, h: s.admin(s.createSource)},

		// Recovery
		{Method: "POST", Path: "/v1/shipments/{id}/recovery", ID: "prepareRecovery", Tag: tagRecovery, Auth: authWallet, Summary: "Prepare a ZK recovery bound to the exporter (3/min)",
			Description: "Commits the recovery evidence and returns the proof for `resumeWithProof`, which the exporter sends from their own wallet. " +
				"When the automatic recovery worker already proved this recovery (a RECOVERY_READY notification), the cached proof is reused and only the commit runs.",
			Signed:  "CargoFlow recovery\nshipment: <id>\nsensor: <sensor>\nsubmitter: <address>\nissued: <t>",
			Request: recoveryRequest{}, Response: service.RecoveryProof{}, h: s.prepareRecovery},
		{Method: "POST", Path: "/v1/shipments/{id}/proof", ID: "recoverWithProof", Tag: tagAdmin, Auth: authAdmin, Summary: "Recover a paused facility end to end (operator)",
			Request: proofRequest{}, Response: service.RecoveryResult{}, h: s.admin(s.proof)},

		// Documents
		{Method: "POST", Path: "/v1/shipments/{id}/documents", ID: "attestDocument", Tag: tagDocuments, Auth: authWallet, Summary: "Attest a file by its hashes (a party)",
			Signed:  "CargoFlow document\nshipment: <id>\nkind: <kind>\nsha256: <0x..>\nissued: <t>",
			Request: documentRequest{}, Response: documentDTO{}, Status: http.StatusCreated, Also: map[int]string{200: "the signer attested this file before"}, h: s.attestDocument},
		{Method: "GET", Path: "/v1/shipments/{id}/documents", ID: "listDocuments", Tag: tagDocuments, Summary: "Document attestations",
			Response: documentList{}, h: s.listDocuments},

		// Alerts
		{Method: "POST", Path: "/v1/shipments/{id}/subscriptions", ID: "subscribe", Tag: tagAlerts, Auth: authWallet, Summary: "Subscribe to alerts (a party or insurer)",
			Description: "Channels: `webhook` (HMAC-signed JSON), `telegram`, `email`, `slack` (an https://hooks.slack.com/ incoming webhook). 503 `channel_unavailable` without credentials.",
			Signed:      "CargoFlow alerts\nshipment: <id>\nchannel: <channel>\ntarget: <target as sent>\nissued: <t>",
			Request:     subscriptionRequest{}, Response: subscriptionCreated{}, Status: http.StatusCreated, h: s.subscribe},
		{Method: "GET", Path: "/v1/shipments/{id}/subscriptions", ID: "listSubscriptions", Tag: tagAlerts, Summary: "An address's subscriptions, targets masked",
			Query: addressQuery, Response: subscriptionList{}, h: s.listSubscriptions},
		{Method: "DELETE", Path: "/v1/shipments/{id}/subscriptions/{sid}", ID: "unsubscribe", Tag: tagAlerts, Auth: authWallet, Summary: "Remove a subscription (the subscriber)",
			Signed:  "CargoFlow alerts off\nsubscription: <sid>\nissued: <t>",
			Request: signedBody{}, Response: deletedResponse{}, h: s.unsubscribe},

		{Method: "GET", Path: "/v1/notifications", ID: "listNotifications", Tag: tagAlerts, Summary: "A wallet's in-app notifications, newest first",
			Description: "Pauses, releases, holds, recovery ready (with a `?recover=1` link), disputes, delivery, settlement, default, cover events and marketplace offers, for every shipment the wallet is a party to.",
			Query: []param{addressQuery[0], {Name: "unread", Description: "true for unread only"},
				{Name: "limit", Description: "1 to 200 (default 50)", Schema: map[string]any{"type": "integer"}}},
			Response: notificationList{}, h: s.notifications},
		{Method: "POST", Path: "/v1/notifications/read", ID: "readNotifications", Tag: tagAlerts, Auth: authWallet, Summary: "Mark notifications read (the notified wallet)",
			Signed:  "CargoFlow notifications read\naddress: <address>\nids: <comma-separated ids, or all>\nissued: <t>",
			Request: notificationsReadBody{}, Response: notificationsReadResult{}, h: s.readNotifications},

		// Parties
		{Method: "GET", Path: "/v1/parties/{address}", ID: "getParty", Tag: tagParties, Summary: "Track record as exporter, financier, buyer and insurer, with a grade",
			Response: partyResponse{}, h: s.party},
		{Method: "POST", Path: "/v1/gas", ID: "requestGas", Tag: tagParties, Auth: authWallet, Summary: "Gas drip for a wallet with none (10/min per client)",
			Signed:  "CargoFlow gas\naddress: <address>\nissued: <t>",
			Request: gasRequest{}, Response: gasResponse{}, h: s.gas},

		// Marketplace
		{Method: "POST", Path: "/v1/requests", ID: "createRequest", Tag: tagMarket, Auth: authWallet, Summary: "Post a financing request (exporter)",
			Signed:  "CargoFlow financing request\nshipment: <id>\namount: <base units>\nmax fee bps: <n>\nmilestones: <n>\nissued: <t>",
			Request: marketRequestBody{}, Response: requestDTO{}, Status: http.StatusCreated, h: s.createRequest},
		{Method: "GET", Path: "/v1/requests", ID: "listRequests", Tag: tagMarket, Summary: "Financing requests, newest first, with offers cheapest first",
			Description: "Each request carries `pricing`, the fee guidance of GET /v1/pricing/suggest.",
			Query:       []param{{Name: "status", Description: "open, accepted, funded or closed"}, {Name: "exporter", Description: "a 0x address"}},
			Response:    requestList{}, h: s.listRequests},
		{Method: "GET", Path: "/v1/pricing/suggest", ID: "suggestFee", Tag: tagMarket, Summary: "Fee guidance for a shipment: a band with its reasons",
			Description: "A transparent, deterministic model over the store's history (financiers still choose the fee):\n\n```\n" +
				"mid    = clamp(300 + grade + excursion + conflict + cargo + cover + tenor, 50, 2000)\n" +
				"spread = 50 (+100 when the corridor has < 20 evaluated epochs) (+50 for a new exporter)\n" +
				"low    = clamp(mid - spread, 0, 2000); high = clamp(mid + spread, 0, 2000)\n\n" +
				"grade      A -75, B 0, C +150, new +50\n" +
				"excursion  +routeExcursionRate/5 (max +400)   conflict +routeConflictRate/10 (max +200)\n" +
				"cargo      frozen +75, chilled +50, controlled_ambient +25, ambient 0, custom +50\n" +
				"cover      active -100, offered -25, none 0\n" +
				"tenor      +5 per day beyond 14 (max +150)\n```\n\n" +
				"Rates are bps of the evaluated epochs of other shipments on the same corridor (first and last waypoints in the same 1-degree cells).",
			Query:    []param{{Name: "shipment", Description: "shipment id", Required: true}},
			Response: pricing.Suggestion{}, h: s.suggestFee},
		{Method: "POST", Path: "/v1/requests/{rid}/offers", ID: "placeOffer", Tag: tagMarket, Auth: authWallet, Summary: "Offer a fee (a financier)",
			Signed:  "CargoFlow offer\nrequest: <rid>\nfee bps: <n>\nissued: <t>",
			Request: offerBody{}, Response: offerDTO{}, Status: http.StatusCreated, Also: map[int]string{200: "replaced your earlier fee"}, h: s.placeOffer},
		{Method: "POST", Path: "/v1/requests/{rid}/accept", ID: "acceptOffer", Tag: tagMarket, Auth: authWallet, Summary: "Accept an offer (exporter)",
			Signed:  "CargoFlow accept\nrequest: <rid>\noffer: <offer id>\nissued: <t>",
			Request: acceptBody{}, Response: requestDTO{}, h: s.acceptOffer},
		{Method: "POST", Path: "/v1/requests/{rid}/close", ID: "closeRequest", Tag: tagMarket, Auth: authWallet, Summary: "Withdraw a request (exporter)",
			Signed:  "CargoFlow close request\nrequest: <rid>\nissued: <t>",
			Request: signedBody{}, Response: requestDTO{}, h: s.closeRequest},

		// Electronic bills of lading (contracts v3)
		{Method: "GET", Path: "/v1/ebl", ID: "listBills", Tag: tagStandards, Summary: "Electronic bills of lading (v3 EBLRegistry)",
			Description: "404 on a deployment without the EBLRegistry. Designed around MLETR concepts (exclusive control, singularity, integrity); not a legal compliance claim.",
			Query:       []param{{Name: "holder", Description: "only bills this 0x address holds"}}, Response: billList{}, h: s.bills},
		{Method: "GET", Path: "/v1/ebl/{tokenId}", ID: "getBill", Tag: tagStandards, Summary: "One bill of lading: parties, holder, status, transfer history and bound shipment",
			Response: store.Bill{}, h: s.bill},

		// Webhooks
		{Method: "POST", Path: "/v1/webhooks/alchemy", ID: "alchemyWebhook", Tag: tagSystem, Auth: authWebhook, Summary: "Alchemy Notify deliveries: wake the indexer",
			Description: "Accepts Custom Webhook (GraphQL log filter) and Address Activity deliveries, at most 1 MB. The raw body must carry a valid " +
				"`X-Alchemy-Signature` (hex HMAC-SHA256 with one of ALCHEMY_WEBHOOK_SIGNING_KEYS; 401 otherwise; 503 `webhook_unavailable` when none are set). " +
				"A delivery id seen in the last 24 hours answers 200 with `duplicate: true` and does nothing. When a log or activity comes from a " +
				"CargoFlow contract the indexer is woken to sync now (up to that block, once CONFIRMATIONS deep); the payload itself is never applied: " +
				"the indexer re-reads the logs from the RPC, so a forged or replayed delivery cannot change state. Other addresses are ignored.",
			Request: alchemyWebhookDoc{}, Response: webhookResult{}, h: s.alchemyWebhook},

		{Method: "POST", Path: "/v1/webhooks/zerodev/{secret}", ID: "zerodevGasPolicy", Tag: tagSystem, Summary: "ZeroDev custom gas policy: sponsor this user operation?",
			Description: "Called by ZeroDev before its paymaster sponsors a user operation. Always answers 200 `{proceed}` (a policy \"no\" is never an error status). " +
				"`proceed` is true only when `projectId` is ZERODEV_PROJECT_ID, `chainId` is CHAIN_ID, the callData is a Kernel v3 `execute` (ERC-7579 single " +
				"or batch call type; never delegatecall) or Kernel v2 `execute` (call) / `executeBatch` whose every call has value 0 and targets a CargoFlow " +
				"contract (controller, vault, cover pool, evidence, shipment and policy registries, eBL and device registries) or is USDG " +
				"`approve(spender, amount)` with a CargoFlow contract as spender; (callGasLimit + verificationGasLimit + preVerificationGas + paymaster " +
				"limits) x maxFeePerGas is at most ZERODEV_SPONSOR_MAX_WEI; and the sender has had fewer than ZERODEV_SPONSOR_PER_DAY and everyone " +
				"fewer than ZERODEV_SPONSOR_GLOBAL_DAY sponsorships in the last 24 hours (counted only when proceeding). Account deployment " +
				"(initCode / factory) is sponsored only together with such calls.",
			Request: zerodevRequestDoc{}, Response: zerodevResponse{}, Also: map[int]string{404: "unknown path (wrong or unset secret)"}, h: s.zerodevWebhook},

		// Admin
		{Method: "POST", Path: "/v1/admin/reconcile", ID: "reconcile", Tag: tagAdmin, Auth: authAdmin, Summary: "Run one reconciliation pass now",
			Response: service.ReconcileReport{}, h: s.admin(s.reconcile)},
	}
}

// wsHandler serves the WebSocket stream, or 503 when no hub is configured.
func (s *Server) wsHandler() http.Handler {
	if s.c.Hub == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			WriteError(w, &Error{http.StatusServiceUnavailable, "unavailable", "the event stream is not enabled"})
		})
	}
	return s.c.Hub.Handler(originHosts(s.c.CORSOrigins))
}
