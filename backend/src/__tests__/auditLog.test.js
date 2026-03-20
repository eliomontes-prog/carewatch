// Tests for audit log service
import { jest } from '@jest/globals';

const mockDbRun = jest.fn().mockResolvedValue(undefined);
const mockDbAll = jest.fn().mockResolvedValue([]);

jest.unstable_mockModule('../db/pool.js', () => ({
  db: {
    run: mockDbRun,
    all: mockDbAll,
    get: jest.fn(),
    pool: {},
  },
  default: {},
}));

const { logAudit, queryAuditLog } = await import('../services/auditLog.js');

describe('Audit Log Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('logAudit', () => {
    it('should insert an audit record with all fields', async () => {
      await logAudit({
        action: 'login',
        resourceType: 'auth',
        resourceId: null,
        detail: 'Login attempt for admin@test.com',
        user: { id: 'user-1', email: 'admin@test.com', role: 'admin' },
        req: { ip: '192.168.1.1', headers: { 'user-agent': 'TestAgent/1.0' } },
        statusCode: 200,
        durationMs: 45,
      });

      expect(mockDbRun).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbRun.mock.calls[0];
      expect(sql).toContain('INSERT INTO audit_log');
      expect(params).toEqual([
        'user-1', 'admin@test.com', 'admin',
        'login', 'auth', null,
        'Login attempt for admin@test.com',
        '192.168.1.1', 'TestAgent/1.0',
        200, 45,
      ]);
    });

    it('should handle missing optional fields gracefully', async () => {
      await logAudit({
        action: 'list_residents',
        resourceType: 'resident',
      });

      expect(mockDbRun).toHaveBeenCalledTimes(1);
      const [, params] = mockDbRun.mock.calls[0];
      expect(params[0]).toBeNull(); // user_id
      expect(params[1]).toBeNull(); // user_email
    });

    it('should not throw when DB write fails', async () => {
      mockDbRun.mockRejectedValueOnce(new Error('DB connection lost'));

      // Should not throw
      await logAudit({
        action: 'login',
        resourceType: 'auth',
      });
    });
  });

  describe('queryAuditLog', () => {
    it('should query with no filters', async () => {
      mockDbAll.mockResolvedValue([{ id: 1, action: 'login' }]);

      const result = await queryAuditLog();

      expect(mockDbAll).toHaveBeenCalledTimes(1);
      const [sql] = mockDbAll.mock.calls[0];
      expect(sql).toContain('SELECT * FROM audit_log');
      expect(sql).toContain('ORDER BY timestamp DESC');
      expect(result).toEqual([{ id: 1, action: 'login' }]);
    });

    it('should apply userId filter', async () => {
      await queryAuditLog({ userId: 'user-1' });

      const [sql, params] = mockDbAll.mock.calls[0];
      expect(sql).toContain('user_id = $1');
      expect(params[0]).toBe('user-1');
    });

    it('should apply multiple filters', async () => {
      await queryAuditLog({
        userId: 'user-1',
        resourceType: 'resident',
        action: 'view_resident',
      });

      const [sql, params] = mockDbAll.mock.calls[0];
      expect(sql).toContain('user_id = $1');
      expect(sql).toContain('resource_type = $2');
      expect(sql).toContain('action = $3');
      expect(params[0]).toBe('user-1');
      expect(params[1]).toBe('resident');
      expect(params[2]).toBe('view_resident');
    });

    it('should respect limit and offset', async () => {
      await queryAuditLog({ limit: 50, offset: 10 });

      const [, params] = mockDbAll.mock.calls[0];
      expect(params).toContain(50);
      expect(params).toContain(10);
    });
  });
});
