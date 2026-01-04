# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of the Exchange Shielded SDK seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### How to Report

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to: security@example.com

You should receive a response within 48 hours. If for some reason you do not, please follow up via email to ensure we received your original message.

Please include the following information in your report:

- Type of issue (e.g., key exposure, authentication bypass, injection, etc.)
- Full paths of source file(s) related to the issue
- Location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your vulnerability report within 48 hours.
- **Communication**: We will keep you informed of the progress towards a fix and full announcement.
- **Credit**: We will credit you in the security advisory (unless you prefer to remain anonymous).

### Disclosure Policy

- We follow a 90-day disclosure timeline
- We will work with you to understand and resolve the issue quickly
- We will prepare a security advisory and patch
- We will coordinate the release of the patch with you

## Security Considerations for Users

### Key Management

1. **Never store spending keys in plain text**
   - Use the `SecureKeyManager` with AES-256-GCM encryption
   - Consider using a Hardware Security Module (HSM) for production

2. **Minimize key exposure time**
   - Load keys only when needed
   - Clear keys immediately after use
   - Enable `autoClearAfterMs` for automatic clearing

3. **Use secure password storage**
   - Encryption passwords should come from a secure secrets manager
   - Never store passwords in environment variables or config files

### Input Validation

1. **Always validate user input**
   ```typescript
   import { sanitizeAddress, sanitizeAmount } from 'exchange-shielded-sdk';

   const addressResult = sanitizeAddress(userInput.address);
   if (!addressResult.valid) {
     throw new Error('Invalid address');
   }
   ```

2. **Use rate limiting**
   - Configure appropriate limits for your use case
   - Monitor rate limit hits for abuse detection

### Audit Logging

1. **Enable audit logging in production**
   ```typescript
   const sdk = createExchangeSDK({
     enableAuditLogging: true,
     // ...
   });
   ```

2. **Ship logs to secure storage**
   - Configure `onEvent` handler to ship logs externally
   - Verify log integrity regularly

3. **Monitor for suspicious activity**
   - Set up alerts for CRITICAL severity events
   - Review suspicious activity flags regularly

### Network Security

1. **Restrict RPC access**
   - Bind zcashd RPC to localhost only
   - Use firewall rules to restrict access
   - Use HTTPS for remote connections

2. **Secure credentials**
   - Use strong RPC passwords
   - Rotate credentials regularly
   - Store credentials in secrets manager

### Deployment Security

1. **Run as non-root**
   - Use a dedicated service account
   - Apply principle of least privilege

2. **Use container security**
   - Run containers as non-root
   - Use read-only filesystem where possible
   - Apply resource limits

3. **Keep dependencies updated**
   - Run `npm audit` regularly
   - Update dependencies promptly for security fixes

## Known Security Considerations

### Address Validation Limitations

The current address validation uses pattern matching and does not perform cryptographic validation. This is suitable for format validation but not for verifying that addresses are valid on-chain. Full cryptographic validation requires WASM bindings to librustzcash (planned for future versions).

### RPC Security

The RPC client uses HTTP Basic authentication. For production deployments:
- Always use HTTPS for remote connections
- Never expose RPC to the public internet
- Consider using SSH tunnels for remote access

### Memory Security

While we make efforts to zero key material from memory, JavaScript/Node.js does not guarantee immediate garbage collection. For highest security:
- Use HSM for key storage
- Minimize key exposure time
- Consider dedicated key management services

## Security Best Practices

See [docs/SECURITY-BEST-PRACTICES.md](./docs/SECURITY-BEST-PRACTICES.md) for comprehensive security guidance.

## Security Updates

Security updates will be released as:
- Patch versions for minor vulnerabilities
- Minor versions for moderate vulnerabilities
- Major versions if breaking changes are required

Subscribe to releases on GitHub to be notified of security updates.

## Bug Bounty

We currently do not have a formal bug bounty program. However, we greatly appreciate security researchers who responsibly disclose vulnerabilities and will acknowledge their contributions publicly (with permission).

## Contact

For security concerns, contact: security@example.com

For general questions, please use GitHub Discussions.
