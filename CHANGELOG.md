# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-01-04

### Added

#### Address Validation
- `validateAddress()` - Detect address type (transparent, sapling, unified)
- `isShielded()` - Check if address is privacy-preserving
- `validateAddressDetailed()` - Comprehensive validation with network detection
- `parseUnifiedAddress()` - Parse unified address components
- `getAddressPrefixes()` - Get valid prefixes for address type and network
- Support for mainnet and testnet addresses
- Support for legacy Sprout addresses (deprecated)

#### Shielded Transaction Builder
- `ShieldedTransactionBuilder` class for building shielded withdrawals
- ZIP 317 compliant fee estimation
- `estimateTransactionFee()` - Calculate fees based on transaction components
- `calculateLogicalActions()` - Calculate logical actions for fee calculation
- `ZIP317` constants for fee calculations
- Support for all privacy policies (FullPrivacy, LegacyCompat, etc.)
- Memo support for shielded recipients (512 bytes max)

#### Zcash RPC Client
- `ZcashRpcClient` class for zcashd/zebrad communication
- `z_sendmany()` - Send shielded transactions
- `z_getbalance()` - Get address balance
- `z_listunspent()` - List unspent shielded notes
- `z_gettotalbalance()` - Get total wallet balance
- `z_getoperationstatus()` - Check operation status
- `z_getoperationresult()` - Get operation result
- `waitForOperation()` - Wait for async operation completion
- `sendAndWait()` - Convenience method combining send and wait
- Configurable timeout and connection settings
- HTTP Basic authentication support

#### Secure Key Manager
- `SecureKeyManager` class for secure key handling
- AES-256-GCM encryption with scrypt key derivation
- Secure memory zeroing when keys are cleared
- Auto-clear inactive keys option
- Keys never appear in logs, errors, or stack traces
- `loadKey()` - Load encrypted key into memory
- `loadRawKey()` - Load unencrypted key (for HSM integration)
- `signTransaction()` - Sign transaction data
- `clearKey()` / `clearAllKeys()` - Securely remove keys from memory
- `encryptKeyForStorage()` - Encrypt key for external storage

#### Input Sanitization
- `sanitizeAddress()` - Validate and sanitize address input
- `sanitizeAmount()` - Validate and sanitize amount input
- `sanitizeMemo()` - Validate and sanitize memo input
- `sanitizeUserId()` - Validate user ID format
- `sanitizeTransactionId()` - Validate transaction ID format
- `textToMemoHex()` / `memoHexToText()` - Convert between text and hex memos
- `redactSensitiveData()` - Redact sensitive fields for safe logging

#### Withdrawal Rate Limiter
- `WithdrawalRateLimiter` class with sliding window algorithm
- Configurable limits per hour and per day
- Maximum amount per single withdrawal
- Maximum total amount per day
- Cooldown period between withdrawals
- `checkLimit()` - Check if withdrawal is allowed
- `recordWithdrawal()` - Record successful withdrawal
- `getRemainingLimit()` - Get remaining limits for user
- `createConservativeRateLimiter()` - Pre-configured for high security
- `createHighVolumeRateLimiter()` - Pre-configured for busy exchanges

#### Audit Logger
- `AuditLogger` class with tamper-evident hash chain
- Automatic redaction of sensitive data
- Configurable severity levels (DEBUG, INFO, WARNING, ERROR, CRITICAL)
- `log()` - Log audit event with automatic hashing
- `getEvents()` - Query events with filtering
- `exportForCompliance()` - Generate compliance report
- `verifyIntegrity()` - Verify audit log chain integrity
- External event handler support for log shipping
- 17 predefined event types for common operations

#### Compliance Manager
- `ComplianceManager` class for regulatory compliance
- Velocity checks with configurable thresholds
- Suspicious activity detection and flagging
- Risk scoring for each transaction
- Viewing key export for auditors
- `checkVelocity()` - Check transaction velocity
- `recordTransaction()` - Record for velocity tracking
- `flagSuspiciousActivity()` - Flag user for review
- `exportViewingKey()` / `exportViewingKeys()` - Export for compliance
- `generateComplianceReport()` - Generate period reports

#### High-Level SDK
- `ExchangeShieldedSDK` class combining all features
- `processWithdrawal()` - End-to-end withdrawal processing
- `estimateWithdrawalFee()` - Estimate withdrawal fee
- `getWithdrawalStatus()` - Check transaction status
- `getComplianceReport()` - Generate compliance report
- `checkRateLimit()` - Check rate limit status
- `checkVelocity()` - Check velocity status
- Automatic input validation and sanitization
- Integrated audit logging
- Integrated compliance checking

#### Documentation
- Comprehensive README with quick start guide
- Full API reference (docs/API.md)
- Exchange integration guide (docs/INTEGRATION-GUIDE.md)
- Security best practices (docs/SECURITY-BEST-PRACTICES.md)
- Working examples for common use cases

#### Testing
- 7 test suites covering all major components
- Unit tests for address validation
- Unit tests for transaction building
- Unit tests for RPC client
- Unit tests for rate limiting
- Unit tests for audit logging
- Integration tests for SDK
- Security tests for key handling

### Technical Details

- TypeScript 5.3+ with strict mode
- ES2022 target with ES Modules
- Node.js 18.0.0+ required
- Zero runtime dependencies (crypto is built-in)
- Full type definitions included

## [0.1.0] - Initial Development

### Added
- Initial address validation module
- Project structure and build configuration
- Basic test framework setup
