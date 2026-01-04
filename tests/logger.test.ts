/**
 * Logger Tests
 *
 * Tests for the structured logging utility.
 */

import { jest } from '@jest/globals';
import {
  Logger,
  LogLevel,
  createLogger,
  defaultLogger,
} from '../src/utils/logger.js';

describe('Logger', () => {
  describe('log levels', () => {
    it('should respect log level settings', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      try {
        const logger = new Logger({ level: LogLevel.WARN });

        // Debug and info should not be logged
        logger.debug('debug message');
        logger.info('info message');
        expect(consoleLogSpy).not.toHaveBeenCalled();

        // Warn and error should be logged
        logger.warn('warn message');
        expect(consoleWarnSpy).toHaveBeenCalledTimes(1);

        logger.error('error message');
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      } finally {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
      }
    });

    it('should not log anything when SILENT', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      try {
        const logger = new Logger({ level: LogLevel.SILENT });

        logger.debug('debug');
        logger.info('info');
        logger.warn('warn');
        logger.error('error');

        expect(consoleLogSpy).not.toHaveBeenCalled();
        expect(consoleWarnSpy).not.toHaveBeenCalled();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
      } finally {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
      }
    });

    it('should log everything when DEBUG', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      try {
        const logger = new Logger({ level: LogLevel.DEBUG });

        logger.debug('debug');
        logger.info('info');
        logger.warn('warn');
        logger.error('error');

        expect(consoleLogSpy).toHaveBeenCalledTimes(2); // debug + info
        expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      } finally {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
      }
    });
  });

  describe('JSON output', () => {
    it('should output valid JSON when json option is true', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      try {
        const logger = new Logger({ level: LogLevel.INFO, json: true });

        logger.info('test message', { userId: 'user-123' });

        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
        const output = consoleLogSpy.mock.calls[0]?.[0] as string;
        expect(typeof output).toBe('string');

        const parsed = JSON.parse(output);
        expect(parsed.level).toBe('INFO');
        expect(parsed.message).toBe('test message');
        expect(parsed.context.userId).toBe('user-123');
        expect(parsed.timestamp).toBeDefined();
      } finally {
        consoleLogSpy.mockRestore();
      }
    });

    it('should include error details in JSON output', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      try {
        const logger = new Logger({ level: LogLevel.ERROR, json: true });
        const testError = new Error('Test error');

        logger.error('operation failed', { operation: 'test' }, testError);

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const output = consoleErrorSpy.mock.calls[0]?.[0] as string;
        const parsed = JSON.parse(output);

        expect(parsed.error.name).toBe('Error');
        expect(parsed.error.message).toBe('Test error');
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });

  describe('text output', () => {
    it('should include prefix in output', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      try {
        const logger = new Logger({ level: LogLevel.INFO, prefix: 'MyApp' });

        logger.info('test message');

        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
        const output = consoleLogSpy.mock.calls[0]?.[0] as string;
        expect(output).toContain('[MyApp]');
        expect(output).toContain('[INFO]');
        expect(output).toContain('test message');
      } finally {
        consoleLogSpy.mockRestore();
      }
    });

    it('should include timestamp when enabled', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      try {
        const logger = new Logger({ level: LogLevel.INFO, timestamps: true });

        logger.info('test message');

        const output = consoleLogSpy.mock.calls[0]?.[0] as string;
        // Should contain ISO timestamp format
        expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      } finally {
        consoleLogSpy.mockRestore();
      }
    });
  });

  describe('child logger', () => {
    it('should create child logger with combined prefix', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      try {
        const parent = new Logger({ level: LogLevel.INFO, prefix: 'Parent' });
        const child = parent.child('Child');

        child.info('test message');

        const output = consoleLogSpy.mock.calls[0]?.[0] as string;
        expect(output).toContain('[Parent:Child]');
      } finally {
        consoleLogSpy.mockRestore();
      }
    });
  });

  describe('level management', () => {
    it('should get current log level', () => {
      const logger = new Logger({ level: LogLevel.WARN });
      expect(logger.getLevel()).toBe(LogLevel.WARN);
    });

    it('should set log level', () => {
      const logger = new Logger({ level: LogLevel.INFO });
      logger.setLevel(LogLevel.DEBUG);
      expect(logger.getLevel()).toBe(LogLevel.DEBUG);
    });

    it('should check if level is enabled', () => {
      const logger = new Logger({ level: LogLevel.WARN });

      expect(logger.isLevelEnabled(LogLevel.ERROR)).toBe(true);
      expect(logger.isLevelEnabled(LogLevel.WARN)).toBe(true);
      expect(logger.isLevelEnabled(LogLevel.INFO)).toBe(false);
      expect(logger.isLevelEnabled(LogLevel.DEBUG)).toBe(false);
    });
  });

  describe('factory function', () => {
    it('should create logger with createLogger()', () => {
      const logger = createLogger({ level: LogLevel.DEBUG });
      expect(logger).toBeInstanceOf(Logger);
      expect(logger.getLevel()).toBe(LogLevel.DEBUG);
    });
  });

  describe('defaultLogger', () => {
    it('should be a Logger instance', () => {
      expect(defaultLogger).toBeInstanceOf(Logger);
    });
  });
});
