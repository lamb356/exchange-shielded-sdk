# Contributing to Exchange Shielded SDK

Thank you for your interest in contributing to the Exchange Shielded SDK! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Security Considerations](#security-considerations)

## Code of Conduct

This project adheres to a code of conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

### Our Standards

- Be respectful and inclusive
- Accept constructive criticism gracefully
- Focus on what is best for the community
- Show empathy towards other community members

## Getting Started

### Prerequisites

- Node.js 18.0.0 or higher
- npm 9.0.0 or higher
- Git
- A running zcashd instance (for integration tests)

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:

```bash
git clone https://github.com/YOUR_USERNAME/exchange-shielded-sdk.git
cd exchange-shielded-sdk
```

3. Add the upstream remote:

```bash
git remote add upstream https://github.com/ORIGINAL_OWNER/exchange-shielded-sdk.git
```

## Development Setup

### Install Dependencies

```bash
npm install
```

### Build the Project

```bash
npm run build
```

### Run Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- address-validator.test.ts
```

### Lint Code

```bash
npm run lint
```

## Making Changes

### Branch Naming

Create a descriptive branch name:

- `feature/add-orchard-support` - New features
- `fix/rate-limiter-overflow` - Bug fixes
- `docs/update-api-reference` - Documentation
- `refactor/cleanup-rpc-client` - Code refactoring
- `test/add-compliance-tests` - Test additions

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, semicolons, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Build process or auxiliary tool changes

Examples:
```
feat(address): add support for unified address parsing

fix(rate-limiter): prevent integer overflow in large amounts

docs(readme): update installation instructions

test(security): add tests for key manager encryption
```

### Keep Changes Focused

- One feature or fix per pull request
- Keep pull requests small and reviewable
- Break large changes into smaller, incremental PRs

## Pull Request Process

### Before Submitting

1. **Update from upstream:**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Run all checks:**
   ```bash
   npm run build
   npm test
   npm run lint
   ```

3. **Update documentation** if needed

4. **Add tests** for new functionality

### Submitting

1. Push your branch to your fork
2. Create a pull request against the `main` branch
3. Fill out the pull request template completely
4. Link any related issues

### Pull Request Template

```markdown
## Description
[Describe what this PR does]

## Type of Change
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Breaking change (fix or feature causing existing functionality to change)
- [ ] Documentation update

## Testing
- [ ] I have added tests that prove my fix/feature works
- [ ] All new and existing tests pass

## Checklist
- [ ] My code follows the project's coding standards
- [ ] I have updated the documentation accordingly
- [ ] I have added appropriate error handling
- [ ] I have considered security implications
```

### Review Process

1. At least one maintainer must approve the PR
2. All CI checks must pass
3. No unresolved conversations
4. Code coverage must not decrease

## Coding Standards

### TypeScript Style

```typescript
// Use explicit types for function parameters and returns
function validateAddress(address: string): AddressType {
  // Implementation
}

// Use interfaces for object types
interface WithdrawalRequest {
  userId: string;
  amount: number;
  toAddress: string;
}

// Use enums for fixed sets of values
enum AuditSeverity {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARNING = 'WARNING',
}

// Prefer const over let, avoid var
const MAX_AMOUNT = 1000;
let currentBalance = 0;

// Use async/await over raw promises
async function processWithdrawal(): Promise<WithdrawalResult> {
  const result = await sendTransaction();
  return result;
}
```

### File Organization

```
src/
  address-validator.ts    # Single-purpose modules
  transaction-builder.ts
  rpc-client.ts
  security/
    index.ts              # Module exports
    key-manager.ts
    rate-limiter.ts
    sanitizer.ts
  compliance/
    index.ts
    audit-logger.ts
    compliance.ts
  sdk/
    index.ts
    exchange-sdk.ts
tests/
  *.test.ts               # Test files mirror src structure
```

### Documentation

- Use JSDoc comments for all public APIs
- Include examples in doc comments
- Keep README and docs in sync with code

```typescript
/**
 * Validates a Zcash address and returns its type.
 *
 * @param address - The address string to validate
 * @returns The detected address type
 *
 * @example
 * ```typescript
 * const type = validateAddress('zs1abc...');
 * console.log(type); // 'sapling'
 * ```
 */
export function validateAddress(address: string): AddressType {
  // ...
}
```

## Testing Guidelines

### Test Structure

```typescript
describe('FeatureName', () => {
  describe('methodName', () => {
    it('should handle normal case', () => {
      // Test implementation
    });

    it('should handle edge case', () => {
      // Test implementation
    });

    it('should throw on invalid input', () => {
      // Test implementation
    });
  });
});
```

### Test Coverage Requirements

- Aim for 90%+ code coverage
- 100% coverage for security-critical code
- All public APIs must have tests
- Include edge cases and error conditions

### Test Categories

1. **Unit tests**: Test individual functions/classes in isolation
2. **Integration tests**: Test component interactions
3. **Security tests**: Test security-critical functionality

## Security Considerations

### Sensitive Data

- **NEVER** log sensitive data (keys, passwords, full addresses)
- Use `redactSensitiveData()` for logging
- Test that sensitive data doesn't leak in errors

### Input Validation

- Validate all external input
- Use sanitization functions from the SDK
- Never trust user input

### Key Handling

- Keys must never appear in logs
- Keys must be zeroed when no longer needed
- Test key clearing functionality

### Security Review Checklist

For security-related changes:

- [ ] No sensitive data in logs
- [ ] Input validation on all user data
- [ ] Proper error handling (no info leakage)
- [ ] Keys properly cleared from memory
- [ ] Rate limiting considered
- [ ] Audit logging for security events

## Getting Help

- Open an issue for bugs or feature requests
- Use discussions for questions
- Check existing issues before creating new ones

## Recognition

Contributors will be recognized in:
- The project's CONTRIBUTORS file
- Release notes for their contributions

Thank you for contributing!
