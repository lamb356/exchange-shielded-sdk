# Exchange Shielded SDK - Python Bindings

Python wrapper for the Exchange Shielded Withdrawal SDK.

## Installation

```bash
pip install exchange-shielded-sdk
```

## Requirements

- Python 3.8+
- Node.js 18+ (for SDK backend)
- The TypeScript SDK must be built first

## Quick Start

```python
from exchange_shielded_sdk import ExchangeClient

# Initialize the client
client = ExchangeClient(
    rpc_host='127.0.0.1',
    rpc_port=8232,
    rpc_user='rpcuser',
    rpc_password='rpcpassword'
)

# Process a withdrawal
result = client.process_withdrawal(
    user_id='user-123',
    from_address='zs1source...',
    to_address='zs1dest...',
    amount=10.5
)

if result.success:
    print(f'Transaction ID: {result.transaction_id}')
else:
    print(f'Error: {result.error}')
```

## Features

- **Shielded Withdrawals**: Process Zcash shielded withdrawals
- **Rate Limiting**: Built-in rate limiting per user
- **Velocity Checks**: Detect unusual transaction patterns
- **Compliance Reporting**: Generate compliance reports
- **Audit Logging**: Tamper-evident audit trail

## API Reference

### ExchangeClient

The main client class for interacting with the SDK.

#### Constructor

```python
ExchangeClient(
    rpc_host: str = '127.0.0.1',
    rpc_port: int = 8232,
    rpc_user: str = '',
    rpc_password: str = '',
    node_path: str = 'node',
    sdk_path: Optional[str] = None,
    enable_compliance: bool = True,
    enable_audit_logging: bool = True
)
```

#### Methods

##### process_withdrawal

Process a shielded withdrawal.

```python
result = client.process_withdrawal(
    user_id='user-123',
    from_address='zs1...',
    to_address='zs1...',
    amount=10.5,
    memo=None,  # Optional
    request_id=None  # Optional
)
```

##### get_withdrawal_status

Get the status of a withdrawal.

```python
status = client.get_withdrawal_status('txid123...')
```

##### estimate_withdrawal_fee

Estimate the fee for a withdrawal.

```python
estimate = client.estimate_withdrawal_fee(10.0, 'zs1dest...')
print(f'Fee: {estimate.fee_zec} ZEC')
```

##### check_rate_limit

Check if a withdrawal would be allowed by rate limits.

```python
check = client.check_rate_limit('user-123', 10.0)
if check.allowed:
    print('Withdrawal allowed')
else:
    print(f'Rate limited: {check.reason}')
```

##### check_velocity

Check velocity limits for a user.

```python
check = client.check_velocity('user-123', 10.0)
print(f'Risk score: {check.risk_score}')
```

##### get_compliance_report

Generate a compliance report.

```python
from datetime import datetime

report = client.get_compliance_report(
    start=datetime(2024, 1, 1),
    end=datetime(2024, 12, 31)
)
```

##### validate_address

Validate a Zcash address.

```python
result = client.validate_address('zs1...')
if result['valid']:
    print(f'Address type: {result["type"]}')
```

## Development

### Building the SDK

First, build the TypeScript SDK:

```bash
cd /path/to/exchange-shielded-sdk
npm install
npm run build
```

### Running Tests

```bash
pip install -e ".[dev]"
pytest
```

## Future Improvements

- Native bindings via PyO3/NAPI for better performance
- Async support for concurrent operations
- Connection pooling for RPC calls

## License

MIT
