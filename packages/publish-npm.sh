#!/usr/bin/env bash
# Publish the three npm packages in one go with one authenticator code: bash packages/publish-npm.sh <otp>
set -e
cd "$(dirname "$0")"
OTP=${1:?usage: publish-npm.sh <one-time code>}
for p in sdk mcp gateway; do (cd "$p" && npm publish --access public --otp="$OTP" 2>&1 | grep -E "^\+|error" ); done
