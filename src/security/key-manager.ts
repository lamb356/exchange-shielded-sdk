/**
 * Secure Key Manager Module
 *
 * Provides secure handling of spending keys for shielded transactions.
 * Keys are held in memory only and are never serialized to logs.
 *
 * SECURITY REQUIREMENTS:
 * - Spending keys NEVER appear in log output
 * - Spending keys NEVER appear in error messages
 * - Spending keys NEVER appear in stack traces
 * - Keys are cleared from memory when no longer needed
 *
 * @packageDocumentation
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

/**
 * Represents a spending key (opaque type for security)
 * The actual key data is stored privately and never exposed
 */
export interface SpendingKey {
  /** Unique identifier for the key */
  readonly id: string;
  /** Key type (e.g., 'sapling', 'orchard') */
  readonly keyType: 'sapling' | 'orchard' | 'unified';
  /** Creation timestamp */
  readonly createdAt: number;
  /** Last used timestamp */
  lastUsedAt?: number;
}

/**
 * Configuration for SecureKeyManager
 */
export interface KeyManagerConfig {
  /** Maximum number of keys to hold in memory */
  maxKeys?: number;
  /** Auto-clear keys after this many milliseconds of inactivity */
  autoClearAfterMs?: number;
  /** Enable key usage logging (without revealing key data) */
  enableUsageLogging?: boolean;
}

/**
 * Result of a signing operation
 */
export interface SigningResult {
  /** The signature bytes */
  signature: Buffer;
  /** Key ID used for signing */
  keyId: string;
  /** Timestamp of signing */
  signedAt: number;
}

/**
 * Error thrown by key manager operations
 * Note: This error intentionally does NOT include key data
 */
export class KeyManagerError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    // Sanitize message to ensure no key data leaks
    super(KeyManagerError.sanitizeMessage(message));
    this.name = 'KeyManagerError';

    // Override stack trace to not include sensitive data
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KeyManagerError);
    }
  }

  /**
   * Sanitize error message to prevent key leakage
   */
  private static sanitizeMessage(message: string): string {
    // Remove any potential hex strings that could be keys (32+ bytes = 64+ hex chars)
    return message.replace(/[0-9a-fA-F]{64,}/g, '[REDACTED]');
  }

  /**
   * Override toString to prevent key leakage
   */
  override toString(): string {
    return `${this.name}: ${this.message} (code: ${this.code})`;
  }

  /**
   * Override toJSON to prevent key leakage in serialization
   */
  toJSON(): object {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
    };
  }
}

/**
 * Internal key data structure (never exposed externally)
 */
interface InternalKeyData {
  /** The actual key bytes (sensitive!) */
  keyBytes: Buffer;
  /** Key metadata */
  metadata: SpendingKey;
}

/**
 * Encryption constants
 */
const ENCRYPTION = {
  ALGORITHM: 'aes-256-gcm',
  KEY_LENGTH: 32,
  IV_LENGTH: 16,
  AUTH_TAG_LENGTH: 16,
  SALT_LENGTH: 32,
  SCRYPT_N: 16384,
  SCRYPT_R: 8,
  SCRYPT_P: 1,
} as const;

/**
 * Secure Key Manager
 *
 * Manages spending keys in memory with strong security guarantees.
 * Keys are encrypted at rest and decrypted only when needed.
 *
 * @example
 * ```typescript
 * const keyManager = new SecureKeyManager();
 *
 * // Load a key from encrypted storage
 * await keyManager.loadKey('key-1', encryptedKeyBuffer, 'password123');
 *
 * // Sign a transaction
 * const signature = keyManager.signTransaction('key-1', txData);
 *
 * // Clear the key when done
 * keyManager.clearKey('key-1');
 * ```
 */
export class SecureKeyManager {
  /** In-memory key storage (never serialized) */
  private readonly keys: Map<string, InternalKeyData>;

  /** Configuration */
  private readonly config: Required<KeyManagerConfig>;

  /** Auto-clear timers */
  private readonly autoClearTimers: Map<string, NodeJS.Timeout>;

  /**
   * Creates a new SecureKeyManager
   *
   * @param config - Configuration options
   */
  constructor(config: KeyManagerConfig = {}) {
    this.keys = new Map();
    this.autoClearTimers = new Map();

    this.config = {
      maxKeys: config.maxKeys ?? 100,
      autoClearAfterMs: config.autoClearAfterMs ?? 0, // 0 = disabled
      enableUsageLogging: config.enableUsageLogging ?? false,
    };
  }

  /**
   * Loads an encrypted key into memory
   *
   * @param keyId - Unique identifier for the key
   * @param encryptedKey - The encrypted key data
   * @param password - Password to decrypt the key
   * @throws KeyManagerError if decryption fails or max keys exceeded
   */
  async loadKey(keyId: string, encryptedKey: Buffer, password: string): Promise<void> {
    // Check max keys limit
    if (this.keys.size >= this.config.maxKeys) {
      throw new KeyManagerError(
        `Maximum number of keys (${this.config.maxKeys}) exceeded`,
        'MAX_KEYS_EXCEEDED'
      );
    }

    // Check if key already exists
    if (this.keys.has(keyId)) {
      throw new KeyManagerError(`Key with ID '${keyId}' already loaded`, 'KEY_ALREADY_EXISTS');
    }

    try {
      // Decrypt the key
      const keyBytes = await this.decryptKey(encryptedKey, password);

      // Determine key type from key length/format
      const keyType = this.detectKeyType(keyBytes);

      // Store the key
      const metadata: SpendingKey = {
        id: keyId,
        keyType,
        createdAt: Date.now(),
      };

      this.keys.set(keyId, {
        keyBytes,
        metadata,
      });

      // Set up auto-clear timer if configured
      this.resetAutoClearTimer(keyId);

      if (this.config.enableUsageLogging) {
        // Log key load without revealing key data
        this.logKeyEvent('KEY_LOADED', keyId);
      }
    } catch (error) {
      // Wrap errors to prevent key data leakage
      if (error instanceof KeyManagerError) {
        throw error;
      }
      throw new KeyManagerError('Failed to load key: decryption error', 'DECRYPTION_FAILED');
    }
  }

  /**
   * Loads a raw (unencrypted) key into memory
   * WARNING: Only use in secure environments where keys are already protected
   *
   * @param keyId - Unique identifier for the key
   * @param keyBytes - The raw key bytes
   * @param keyType - The type of key
   */
  loadRawKey(
    keyId: string,
    keyBytes: Buffer,
    keyType: 'sapling' | 'orchard' | 'unified'
  ): void {
    // Check max keys limit
    if (this.keys.size >= this.config.maxKeys) {
      throw new KeyManagerError(
        `Maximum number of keys (${this.config.maxKeys}) exceeded`,
        'MAX_KEYS_EXCEEDED'
      );
    }

    // Check if key already exists
    if (this.keys.has(keyId)) {
      throw new KeyManagerError(`Key with ID '${keyId}' already loaded`, 'KEY_ALREADY_EXISTS');
    }

    // Make a copy of the key bytes
    const keyBytesCopy = Buffer.alloc(keyBytes.length);
    keyBytes.copy(keyBytesCopy);

    const metadata: SpendingKey = {
      id: keyId,
      keyType,
      createdAt: Date.now(),
    };

    this.keys.set(keyId, {
      keyBytes: keyBytesCopy,
      metadata,
    });

    // Set up auto-clear timer if configured
    this.resetAutoClearTimer(keyId);

    if (this.config.enableUsageLogging) {
      this.logKeyEvent('KEY_LOADED', keyId);
    }
  }

  /**
   * Signs transaction data with a key
   *
   * Note: This is a simplified signing implementation.
   * In production, this would use librustzcash for proper Zcash signing.
   *
   * @param keyId - ID of the key to use for signing
   * @param txData - Transaction data to sign
   * @returns The signature
   * @throws KeyManagerError if key not found
   */
  signTransaction(keyId: string, txData: Buffer): Buffer {
    const keyData = this.keys.get(keyId);

    if (!keyData) {
      throw new KeyManagerError(`Key with ID '${keyId}' not found`, 'KEY_NOT_FOUND');
    }

    try {
      // Update last used timestamp
      keyData.metadata.lastUsedAt = Date.now();

      // Reset auto-clear timer
      this.resetAutoClearTimer(keyId);

      // Sign the transaction data
      // In production, this would use proper Zcash signing via librustzcash
      const signature = this.computeSignature(keyData.keyBytes, txData);

      if (this.config.enableUsageLogging) {
        this.logKeyEvent('KEY_USED_FOR_SIGNING', keyId);
      }

      return signature;
    } catch (error) {
      // Wrap errors to prevent key data leakage
      throw new KeyManagerError('Failed to sign transaction', 'SIGNING_FAILED');
    }
  }

  /**
   * Clears a specific key from memory
   *
   * @param keyId - ID of the key to clear
   * @returns true if key was cleared, false if not found
   */
  clearKey(keyId: string): boolean {
    const keyData = this.keys.get(keyId);

    if (!keyData) {
      return false;
    }

    // Securely zero out the key bytes
    this.secureZeroBuffer(keyData.keyBytes);

    // Clear the auto-clear timer
    const timer = this.autoClearTimers.get(keyId);
    if (timer) {
      clearTimeout(timer);
      this.autoClearTimers.delete(keyId);
    }

    // Remove from map
    this.keys.delete(keyId);

    if (this.config.enableUsageLogging) {
      this.logKeyEvent('KEY_CLEARED', keyId);
    }

    return true;
  }

  /**
   * Clears all keys from memory
   */
  clearAllKeys(): void {
    // Clear all auto-clear timers
    for (const timer of this.autoClearTimers.values()) {
      clearTimeout(timer);
    }
    this.autoClearTimers.clear();

    // Securely zero out all keys
    for (const keyData of this.keys.values()) {
      this.secureZeroBuffer(keyData.keyBytes);
    }

    // Clear the map
    this.keys.clear();

    if (this.config.enableUsageLogging) {
      this.logKeyEvent('ALL_KEYS_CLEARED', 'all');
    }
  }

  /**
   * Gets metadata for a loaded key (without exposing key bytes)
   *
   * @param keyId - ID of the key
   * @returns Key metadata or undefined if not found
   */
  getKeyMetadata(keyId: string): SpendingKey | undefined {
    const keyData = this.keys.get(keyId);
    if (!keyData) {
      return undefined;
    }

    // Return a copy of metadata (not the internal reference)
    return { ...keyData.metadata };
  }

  /**
   * Gets the number of keys currently loaded
   */
  getKeyCount(): number {
    return this.keys.size;
  }

  /**
   * Lists all loaded key IDs (without exposing key data)
   */
  listKeyIds(): string[] {
    return Array.from(this.keys.keys());
  }

  /**
   * Checks if a key is loaded
   *
   * @param keyId - ID of the key to check
   */
  hasKey(keyId: string): boolean {
    return this.keys.has(keyId);
  }

  /**
   * Encrypts a key for storage
   *
   * @param keyBytes - The raw key bytes to encrypt
   * @param password - Password to use for encryption
   * @returns Encrypted key data
   */
  async encryptKeyForStorage(keyBytes: Buffer, password: string): Promise<Buffer> {
    // Generate salt and IV
    const salt = randomBytes(ENCRYPTION.SALT_LENGTH);
    const iv = randomBytes(ENCRYPTION.IV_LENGTH);

    // Derive encryption key from password
    const derivedKey = (await scryptAsync(password, salt, ENCRYPTION.KEY_LENGTH)) as Buffer;

    // Encrypt the key
    const cipher = createCipheriv(ENCRYPTION.ALGORITHM, derivedKey, iv);
    const encrypted = Buffer.concat([cipher.update(keyBytes), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Format: salt (32) + iv (16) + authTag (16) + encrypted data
    return Buffer.concat([salt, iv, authTag, encrypted]);
  }

  /**
   * Decrypts an encrypted key
   */
  private async decryptKey(encryptedData: Buffer, password: string): Promise<Buffer> {
    const minLength = ENCRYPTION.SALT_LENGTH + ENCRYPTION.IV_LENGTH + ENCRYPTION.AUTH_TAG_LENGTH;
    if (encryptedData.length < minLength) {
      throw new KeyManagerError('Invalid encrypted key format', 'INVALID_FORMAT');
    }

    // Extract components
    const salt = encryptedData.subarray(0, ENCRYPTION.SALT_LENGTH);
    const iv = encryptedData.subarray(
      ENCRYPTION.SALT_LENGTH,
      ENCRYPTION.SALT_LENGTH + ENCRYPTION.IV_LENGTH
    );
    const authTag = encryptedData.subarray(
      ENCRYPTION.SALT_LENGTH + ENCRYPTION.IV_LENGTH,
      ENCRYPTION.SALT_LENGTH + ENCRYPTION.IV_LENGTH + ENCRYPTION.AUTH_TAG_LENGTH
    );
    const encrypted = encryptedData.subarray(
      ENCRYPTION.SALT_LENGTH + ENCRYPTION.IV_LENGTH + ENCRYPTION.AUTH_TAG_LENGTH
    );

    // Derive decryption key from password
    const derivedKey = (await scryptAsync(password, salt, ENCRYPTION.KEY_LENGTH)) as Buffer;

    // Decrypt
    const decipher = createDecipheriv(ENCRYPTION.ALGORITHM, derivedKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    return decrypted;
  }

  /**
   * Detects the key type from key bytes
   */
  private detectKeyType(keyBytes: Buffer): 'sapling' | 'orchard' | 'unified' {
    // Simplified detection based on key length
    // In production, this would use proper key parsing
    const length = keyBytes.length;

    if (length === 32) {
      return 'sapling'; // Sapling spending key is 32 bytes
    } else if (length === 64) {
      return 'orchard'; // Orchard spending key is 64 bytes
    }

    return 'unified'; // Default to unified for other sizes
  }

  /**
   * Computes a signature for transaction data
   * Note: Simplified implementation - production would use librustzcash
   */
  private computeSignature(keyBytes: Buffer, txData: Buffer): Buffer {
    // Create HMAC signature (simplified - real implementation would use proper Zcash signing)
    const hmac = createHash('sha256');
    hmac.update(keyBytes);
    hmac.update(txData);
    return hmac.digest();
  }

  /**
   * Securely zeros out a buffer
   */
  private secureZeroBuffer(buffer: Buffer): void {
    // Fill with zeros
    buffer.fill(0);

    // Multiple passes for extra security
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = 0;
    }
  }

  /**
   * Resets the auto-clear timer for a key
   */
  private resetAutoClearTimer(keyId: string): void {
    if (this.config.autoClearAfterMs <= 0) {
      return;
    }

    // Clear existing timer
    const existingTimer = this.autoClearTimers.get(keyId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.clearKey(keyId);
    }, this.config.autoClearAfterMs);

    this.autoClearTimers.set(keyId, timer);
  }

  /**
   * Logs a key event without revealing key data
   */
  private logKeyEvent(event: string, keyId: string): void {
    // Safe logging - never include key data
    const timestamp = new Date().toISOString();
    console.log(`[KeyManager] ${timestamp} - ${event}: keyId=${keyId}`);
  }

  /**
   * Override toString to prevent accidental key exposure
   */
  toString(): string {
    return `[SecureKeyManager: ${this.keys.size} keys loaded]`;
  }

  /**
   * Override toJSON to prevent accidental key exposure in serialization
   */
  toJSON(): object {
    return {
      type: 'SecureKeyManager',
      keyCount: this.keys.size,
      keyIds: Array.from(this.keys.keys()),
    };
  }

  /**
   * Custom inspect for Node.js to prevent key exposure in console
   */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString();
  }
}

/**
 * Creates a new SecureKeyManager instance
 *
 * @param config - Configuration options
 * @returns A new SecureKeyManager
 */
export function createKeyManager(config?: KeyManagerConfig): SecureKeyManager {
  return new SecureKeyManager(config);
}
