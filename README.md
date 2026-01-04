# Exchange Shielded Withdrawal SDK

A TypeScript SDK for validating Zcash addresses, supporting transparent, Sprout, Sapling, and Unified address formats.

## Features

- Validate Zcash addresses (transparent, Sprout, Sapling, Unified)
- Detect shielded vs transparent addresses
- Parse Unified Address components
- TypeScript-first with full type definitions
- ES Module support
- Zero runtime dependencies

## Installation

```bash
npm install exchange-shielded-sdk
```

## Usage

### Basic Address Validation

```typescript
import { validateAddress, isShielded } from 'exchange-shielded-sdk';

// Validate address type
const type = validateAddress('t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU');
console.log(type); // 'transparent'

const saplingType = validateAddress('zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly');
console.log(saplingType); // 'sapling'

// Check if address is shielded
const shielded = isShielded('zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly');
console.log(shielded); // true
```

### Detailed Validation

```typescript
import { validateAddressDetailed } from 'exchange-shielded-sdk';

const result = validateAddressDetailed('t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU');
console.log(result);
// {
//   valid: true,
//   type: 'transparent',
//   shielded: false,
//   network: 'mainnet'
// }

const invalid = validateAddressDetailed('invalid-address');
console.log(invalid);
// {
//   valid: false,
//   type: 'unknown',
//   shielded: false,
//   network: 'unknown',
//   error: 'Unrecognized address format'
// }
```

### Unified Address Parsing

```typescript
import { parseUnifiedAddress } from 'exchange-shielded-sdk';

const components = parseUnifiedAddress('u1qw508d6qejxtdg4y5r3zarvary0c5xw7...');
console.log(components);
// {
//   orchard: true,
//   sapling: undefined,
//   transparent: undefined
// }
```

### Get Address Prefixes

```typescript
import { getAddressPrefixes } from 'exchange-shielded-sdk';

const mainnetPrefixes = getAddressPrefixes('sapling', 'mainnet');
console.log(mainnetPrefixes); // ['zs']

const testnetPrefixes = getAddressPrefixes('transparent', 'testnet');
console.log(testnetPrefixes); // ['tm', 't2']
```

## Address Types

| Type | Prefix | Encoding | Description |
|------|--------|----------|-------------|
| Transparent (P2PKH) | `t1` | Base58Check | Pay-to-Public-Key-Hash (mainnet) |
| Transparent (P2SH) | `t3` | Base58Check | Pay-to-Script-Hash (mainnet) |
| Transparent (testnet) | `tm`, `t2` | Base58Check | Testnet transparent addresses |
| Sprout | `zc`, `zt` | Base58Check | Legacy shielded (deprecated) |
| Sapling | `zs` | Bech32 | Current shielded address format |
| Sapling (testnet) | `ztestsapling` | Bech32 | Testnet Sapling addresses |
| Unified | `u1` | Bech32m | Multi-receiver address (NU5+) |
| Unified (testnet) | `utest` | Bech32m | Testnet unified addresses |

## API Reference

### Types

```typescript
type AddressType = 'transparent' | 'sprout' | 'sapling' | 'orchard' | 'unified' | 'unknown';

interface UnifiedAddressComponents {
  transparent?: string;
  sapling?: string;
  orchard?: boolean;
}

interface AddressValidationResult {
  valid: boolean;
  type: AddressType;
  shielded: boolean;
  network: 'mainnet' | 'testnet' | 'unknown';
  error?: string;
}
```

### Functions

#### `validateAddress(address: string): AddressType`

Detects the type of a Zcash address based on its prefix and format.

#### `isShielded(address: string): boolean`

Returns `true` if the address is a shielded type (Sprout, Sapling, Orchard, or Unified).

#### `parseUnifiedAddress(ua: string): UnifiedAddressComponents`

Parses a Unified Address to detect its component receivers. Note: Full parsing requires WASM bindings (planned for future versions).

#### `validateAddressDetailed(address: string): AddressValidationResult`

Performs comprehensive validation with detailed results including network detection.

#### `getAddressPrefixes(type: AddressType, network?: 'mainnet' | 'testnet'): string[]`

Returns the valid prefixes for a given address type and network.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

## Roadmap

- [ ] WASM bindings to librustzcash for cryptographic validation
- [ ] Full Unified Address decoding (extract actual receiver addresses)
- [ ] Address generation utilities
- [ ] Viewing key support

## License

MIT
