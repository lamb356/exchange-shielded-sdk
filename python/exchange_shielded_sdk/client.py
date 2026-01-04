"""
Exchange Shielded SDK Client

Python client that wraps the TypeScript SDK via Node.js subprocess.
"""

import json
import subprocess
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Dict, Any, List
from pathlib import Path


class SDKError(Exception):
    """Error raised by SDK operations."""

    def __init__(self, message: str, code: str = "UNKNOWN"):
        super().__init__(message)
        self.code = code


@dataclass
class WithdrawalRequest:
    """Withdrawal request parameters."""

    user_id: str
    from_address: str
    to_address: str
    amount: float
    memo: Optional[str] = None
    request_id: Optional[str] = None


@dataclass
class WithdrawalResult:
    """Result of a withdrawal operation."""

    success: bool
    transaction_id: Optional[str] = None
    operation_id: Optional[str] = None
    error: Optional[str] = None
    error_code: Optional[str] = None
    fee: Optional[float] = None
    request_id: Optional[str] = None
    completed_at: Optional[datetime] = None


@dataclass
class WithdrawalStatus:
    """Status of a withdrawal."""

    status: str  # 'pending', 'processing', 'completed', 'failed', 'unknown'
    transaction_id: Optional[str] = None
    confirmations: Optional[int] = None
    error: Optional[str] = None
    updated_at: Optional[datetime] = None


@dataclass
class FeeEstimate:
    """Fee estimate for a withdrawal."""

    fee_zec: float
    fee_zatoshis: int
    logical_actions: int
    is_approximate: bool


@dataclass
class RateLimitResult:
    """Result of a rate limit check."""

    allowed: bool
    reason: Optional[str] = None
    retry_after_ms: Optional[int] = None
    usage: Dict[str, Any] = field(default_factory=dict)


@dataclass
class VelocityCheckResult:
    """Result of a velocity check."""

    passed: bool
    velocity: Dict[str, Any] = field(default_factory=dict)
    thresholds: Dict[str, Any] = field(default_factory=dict)
    reason: Optional[str] = None
    risk_score: int = 0


@dataclass
class ComplianceReport:
    """Compliance report data."""

    generated_at: datetime
    period_start: datetime
    period_end: datetime
    summary: Dict[str, Any] = field(default_factory=dict)
    events_by_type: Dict[str, int] = field(default_factory=dict)
    events_by_severity: Dict[str, int] = field(default_factory=dict)
    integrity_check: Dict[str, Any] = field(default_factory=dict)


class ExchangeClient:
    """
    Python client for the Exchange Shielded SDK.

    This client communicates with the TypeScript SDK via Node.js subprocess.
    For production use, consider implementing native bindings via PyO3 or NAPI.

    Args:
        rpc_host: zcashd RPC host address
        rpc_port: zcashd RPC port
        rpc_user: RPC username
        rpc_password: RPC password
        node_path: Path to Node.js executable (default: 'node')
        sdk_path: Path to SDK directory (default: auto-detect)
        enable_compliance: Enable compliance features
        enable_audit_logging: Enable audit logging

    Example:
        >>> client = ExchangeClient(
        ...     rpc_host='127.0.0.1',
        ...     rpc_port=8232,
        ...     rpc_user='user',
        ...     rpc_password='password'
        ... )
        >>> result = client.process_withdrawal(
        ...     user_id='user-123',
        ...     from_address='zs1...',
        ...     to_address='zs1...',
        ...     amount=1.5
        ... )
    """

    def __init__(
        self,
        rpc_host: str = "127.0.0.1",
        rpc_port: int = 8232,
        rpc_user: str = "",
        rpc_password: str = "",
        node_path: str = "node",
        sdk_path: Optional[str] = None,
        enable_compliance: bool = True,
        enable_audit_logging: bool = True,
    ):
        self.rpc_host = rpc_host
        self.rpc_port = rpc_port
        self.rpc_user = rpc_user
        self.rpc_password = rpc_password
        self.node_path = node_path
        self.enable_compliance = enable_compliance
        self.enable_audit_logging = enable_audit_logging

        # Auto-detect SDK path
        if sdk_path is None:
            # Look for SDK relative to this file
            current_dir = Path(__file__).parent
            sdk_path = str(current_dir.parent.parent)

        self.sdk_path = sdk_path
        self._cli_script_path = os.path.join(sdk_path, "dist", "cli.js")

        # Validate SDK exists
        if not os.path.exists(os.path.join(sdk_path, "package.json")):
            raise SDKError(
                f"SDK not found at {sdk_path}. Please build the SDK first.",
                "SDK_NOT_FOUND",
            )

    def _call_sdk(self, command: str, **kwargs) -> Dict[str, Any]:
        """
        Call the SDK via Node.js subprocess.

        Args:
            command: The SDK command to execute
            **kwargs: Command arguments

        Returns:
            Parsed JSON response from SDK

        Raises:
            SDKError: If the SDK call fails
        """
        # Prepare the command payload
        payload = {
            "command": command,
            "config": {
                "rpc": {
                    "host": self.rpc_host,
                    "port": self.rpc_port,
                    "auth": {
                        "username": self.rpc_user,
                        "password": self.rpc_password,
                    },
                },
                "enableCompliance": self.enable_compliance,
                "enableAuditLogging": self.enable_audit_logging,
            },
            "args": kwargs,
        }

        # Create inline script to run
        script = f"""
const {{ ExchangeShieldedSDK }} = require('./dist/index.js');

const payload = {json.dumps(payload)};

async function run() {{
    const sdk = new ExchangeShieldedSDK(payload.config);

    try {{
        let result;
        switch (payload.command) {{
            case 'processWithdrawal':
                result = await sdk.processWithdrawal(payload.args);
                break;
            case 'getWithdrawalStatus':
                result = await sdk.getWithdrawalStatus(payload.args.txId);
                break;
            case 'estimateWithdrawalFee':
                result = await sdk.estimateWithdrawalFee(
                    payload.args.amount,
                    payload.args.destination
                );
                break;
            case 'checkRateLimit':
                result = sdk.checkRateLimit(payload.args.userId, payload.args.amount);
                break;
            case 'checkVelocity':
                result = sdk.checkVelocity(payload.args.userId, payload.args.amount);
                break;
            case 'getComplianceReport':
                result = await sdk.getComplianceReport({{
                    start: new Date(payload.args.start),
                    end: new Date(payload.args.end)
                }});
                break;
            default:
                throw new Error('Unknown command: ' + payload.command);
        }}
        console.log(JSON.stringify({{ success: true, result }}));
    }} catch (error) {{
        console.log(JSON.stringify({{
            success: false,
            error: error.message,
            code: error.code || 'UNKNOWN'
        }}));
    }}
}}

run();
"""

        try:
            result = subprocess.run(
                [self.node_path, "-e", script],
                cwd=self.sdk_path,
                capture_output=True,
                text=True,
                timeout=60,
            )

            if result.returncode != 0:
                stderr = result.stderr.strip()
                raise SDKError(f"Node.js execution failed: {stderr}", "NODE_ERROR")

            stdout = result.stdout.strip()
            if not stdout:
                raise SDKError("Empty response from SDK", "EMPTY_RESPONSE")

            response = json.loads(stdout)

            if not response.get("success"):
                raise SDKError(
                    response.get("error", "Unknown error"),
                    response.get("code", "UNKNOWN"),
                )

            return response.get("result", {})

        except subprocess.TimeoutExpired:
            raise SDKError("SDK call timed out", "TIMEOUT")
        except json.JSONDecodeError as e:
            raise SDKError(f"Failed to parse SDK response: {e}", "PARSE_ERROR")

    def process_withdrawal(
        self,
        user_id: str,
        from_address: str,
        to_address: str,
        amount: float,
        memo: Optional[str] = None,
        request_id: Optional[str] = None,
    ) -> WithdrawalResult:
        """
        Process a shielded withdrawal.

        Args:
            user_id: User identifier
            from_address: Source shielded address
            to_address: Destination address
            amount: Amount in ZEC
            memo: Optional memo (for shielded recipients)
            request_id: Optional request ID for tracking

        Returns:
            WithdrawalResult with transaction details

        Raises:
            SDKError: If the withdrawal fails

        Example:
            >>> result = client.process_withdrawal(
            ...     user_id='user-123',
            ...     from_address='zs1source...',
            ...     to_address='zs1dest...',
            ...     amount=10.5
            ... )
            >>> if result.success:
            ...     print(f'Transaction: {result.transaction_id}')
        """
        result = self._call_sdk(
            "processWithdrawal",
            userId=user_id,
            fromAddress=from_address,
            toAddress=to_address,
            amount=amount,
            memo=memo,
            requestId=request_id,
        )

        completed_at = None
        if result.get("completedAt"):
            completed_at = datetime.fromisoformat(
                result["completedAt"].replace("Z", "+00:00")
            )

        return WithdrawalResult(
            success=result.get("success", False),
            transaction_id=result.get("transactionId"),
            operation_id=result.get("operationId"),
            error=result.get("error"),
            error_code=result.get("errorCode"),
            fee=result.get("fee"),
            request_id=result.get("requestId"),
            completed_at=completed_at,
        )

    def get_withdrawal_status(self, tx_id: str) -> WithdrawalStatus:
        """
        Get the status of a withdrawal by transaction ID.

        Args:
            tx_id: Transaction ID

        Returns:
            WithdrawalStatus with current status

        Example:
            >>> status = client.get_withdrawal_status('abc123...')
            >>> print(f'Status: {status.status}')
        """
        result = self._call_sdk("getWithdrawalStatus", txId=tx_id)

        updated_at = None
        if result.get("updatedAt"):
            updated_at = datetime.fromisoformat(
                result["updatedAt"].replace("Z", "+00:00")
            )

        return WithdrawalStatus(
            status=result.get("status", "unknown"),
            transaction_id=result.get("transactionId"),
            confirmations=result.get("confirmations"),
            error=result.get("error"),
            updated_at=updated_at,
        )

    def estimate_withdrawal_fee(self, amount: float, destination: str) -> FeeEstimate:
        """
        Estimate the fee for a withdrawal.

        Args:
            amount: Withdrawal amount in ZEC
            destination: Destination address

        Returns:
            FeeEstimate with fee details

        Example:
            >>> estimate = client.estimate_withdrawal_fee(10.0, 'zs1dest...')
            >>> print(f'Fee: {estimate.fee_zec} ZEC')
        """
        result = self._call_sdk(
            "estimateWithdrawalFee", amount=amount, destination=destination
        )

        return FeeEstimate(
            fee_zec=result.get("feeZec", 0.0001),
            fee_zatoshis=result.get("feeZatoshis", 10000),
            logical_actions=result.get("logicalActions", 2),
            is_approximate=result.get("isApproximate", True),
        )

    def check_rate_limit(self, user_id: str, amount: float) -> RateLimitResult:
        """
        Check if a withdrawal would be allowed by rate limits.

        Args:
            user_id: User identifier
            amount: Withdrawal amount in ZEC

        Returns:
            RateLimitResult indicating if the withdrawal is allowed

        Example:
            >>> check = client.check_rate_limit('user-123', 10.0)
            >>> if check.allowed:
            ...     print('Withdrawal allowed')
            ... else:
            ...     print(f'Rate limited: {check.reason}')
        """
        result = self._call_sdk("checkRateLimit", userId=user_id, amount=amount)

        return RateLimitResult(
            allowed=result.get("allowed", False),
            reason=result.get("reason"),
            retry_after_ms=result.get("retryAfterMs"),
            usage=result.get("usage", {}),
        )

    def check_velocity(self, user_id: str, amount: float) -> VelocityCheckResult:
        """
        Check velocity limits for a user.

        Args:
            user_id: User identifier
            amount: Withdrawal amount in ZEC

        Returns:
            VelocityCheckResult with velocity information

        Example:
            >>> check = client.check_velocity('user-123', 10.0)
            >>> print(f'Risk score: {check.risk_score}')
        """
        result = self._call_sdk("checkVelocity", userId=user_id, amount=amount)

        return VelocityCheckResult(
            passed=result.get("passed", False),
            velocity=result.get("velocity", {}),
            thresholds=result.get("thresholds", {}),
            reason=result.get("reason"),
            risk_score=result.get("riskScore", 0),
        )

    def get_compliance_report(
        self, start: datetime, end: datetime
    ) -> ComplianceReport:
        """
        Generate a compliance report for a given period.

        Args:
            start: Start of the report period
            end: End of the report period

        Returns:
            ComplianceReport with compliance data

        Example:
            >>> from datetime import datetime
            >>> report = client.get_compliance_report(
            ...     start=datetime(2024, 1, 1),
            ...     end=datetime(2024, 12, 31)
            ... )
            >>> print(f'Total events: {report.summary.get("totalEvents")}')
        """
        result = self._call_sdk(
            "getComplianceReport",
            start=start.isoformat(),
            end=end.isoformat(),
        )

        generated_at = datetime.fromisoformat(
            result.get("generatedAt", datetime.now().isoformat()).replace("Z", "+00:00")
        )
        period_start = datetime.fromisoformat(
            result.get("periodStart", start.isoformat()).replace("Z", "+00:00")
        )
        period_end = datetime.fromisoformat(
            result.get("periodEnd", end.isoformat()).replace("Z", "+00:00")
        )

        return ComplianceReport(
            generated_at=generated_at,
            period_start=period_start,
            period_end=period_end,
            summary=result.get("summary", {}),
            events_by_type=result.get("eventsByType", {}),
            events_by_severity=result.get("eventsBySeverity", {}),
            integrity_check=result.get("integrityCheck", {}),
        )

    def validate_address(self, address: str) -> Dict[str, Any]:
        """
        Validate a Zcash address.

        Note: This is a simpler operation that can be done without
        calling the full SDK. Uses inline validation logic.

        Args:
            address: Address to validate

        Returns:
            Dict with validation result

        Example:
            >>> result = client.validate_address('zs1...')
            >>> print(f'Valid: {result["valid"]}, Type: {result["type"]}')
        """
        # Simple validation without SDK call
        address = address.strip()

        # Check transparent addresses
        if address.startswith(("t1", "t3")) and len(address) == 35:
            return {"valid": True, "type": "transparent", "shielded": False}

        # Check testnet transparent
        if address.startswith(("tm", "t2")) and len(address) == 35:
            return {"valid": True, "type": "transparent", "shielded": False}

        # Check Sapling addresses
        if address.startswith("zs") and 70 <= len(address) <= 90:
            return {"valid": True, "type": "sapling", "shielded": True}

        # Check unified addresses
        if address.startswith("u1") and 50 <= len(address) <= 500:
            return {"valid": True, "type": "unified", "shielded": True}

        # Check Sprout addresses (legacy)
        if address.startswith("zc") and len(address) == 95:
            return {"valid": True, "type": "sprout", "shielded": True}

        return {"valid": False, "type": "unknown", "shielded": False}
