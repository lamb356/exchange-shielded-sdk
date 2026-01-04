"""
Exchange Shielded SDK - Python Bindings

A Python wrapper for the Exchange Shielded Withdrawal SDK.
Provides access to Zcash shielded transaction functionality via Node.js subprocess.

Example usage:
    from exchange_shielded_sdk import ExchangeClient

    client = ExchangeClient(
        rpc_host='127.0.0.1',
        rpc_port=8232,
        rpc_user='user',
        rpc_password='password'
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
"""

from .client import (
    ExchangeClient,
    WithdrawalRequest,
    WithdrawalResult,
    WithdrawalStatus,
    FeeEstimate,
    RateLimitResult,
    VelocityCheckResult,
    ComplianceReport,
    SDKError,
)

__version__ = "0.1.0"
__all__ = [
    "ExchangeClient",
    "WithdrawalRequest",
    "WithdrawalResult",
    "WithdrawalStatus",
    "FeeEstimate",
    "RateLimitResult",
    "VelocityCheckResult",
    "ComplianceReport",
    "SDKError",
]
