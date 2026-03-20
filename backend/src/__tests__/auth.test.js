// Tests for auth service (JWT + password hashing)
import { jest } from '@jest/globals';

// Mock jsonwebtoken
const mockSign = jest.fn();
const mockVerify = jest.fn();
jest.unstable_mockModule('jsonwebtoken', () => ({
  default: { sign: mockSign, verify: mockVerify },
}));

// Mock bcryptjs
const mockHash = jest.fn();
const mockCompare = jest.fn();
jest.unstable_mockModule('bcryptjs', () => ({
  default: { hash: mockHash, compare: mockCompare },
}));

const { signToken, verifyToken, hashPassword, checkPassword } = await import('../services/auth.js');

describe('Auth Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret';
    process.env.JWT_EXPIRES_IN = '1h';
  });

  describe('signToken', () => {
    it('should sign a JWT with the correct payload and options', () => {
      const payload = { id: 'user-1', email: 'test@example.com', role: 'admin' };
      mockSign.mockReturnValue('signed-token');

      const result = signToken(payload);

      expect(mockSign).toHaveBeenCalledWith(payload, 'test-secret', { expiresIn: '1h' });
      expect(result).toBe('signed-token');
    });

    it('should use default secret when JWT_SECRET is not set', () => {
      delete process.env.JWT_SECRET;
      const payload = { id: 'user-1' };
      mockSign.mockReturnValue('token');

      signToken(payload);

      expect(mockSign).toHaveBeenCalledWith(
        payload,
        'dev-secret-change-in-production',
        expect.any(Object)
      );
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', () => {
      const decoded = { id: 'user-1', email: 'test@example.com' };
      mockVerify.mockReturnValue(decoded);

      const result = verifyToken('valid-token');

      expect(mockVerify).toHaveBeenCalledWith('valid-token', 'test-secret');
      expect(result).toEqual(decoded);
    });

    it('should throw on invalid token', () => {
      mockVerify.mockImplementation(() => { throw new Error('invalid token'); });

      expect(() => verifyToken('bad-token')).toThrow('invalid token');
    });
  });

  describe('hashPassword', () => {
    it('should hash with bcrypt using 12 rounds', async () => {
      mockHash.mockResolvedValue('hashed-password');

      const result = await hashPassword('my-password');

      expect(mockHash).toHaveBeenCalledWith('my-password', 12);
      expect(result).toBe('hashed-password');
    });
  });

  describe('checkPassword', () => {
    it('should return true for matching password', async () => {
      mockCompare.mockResolvedValue(true);

      const result = await checkPassword('plain', 'hash');

      expect(mockCompare).toHaveBeenCalledWith('plain', 'hash');
      expect(result).toBe(true);
    });

    it('should return false for non-matching password', async () => {
      mockCompare.mockResolvedValue(false);

      const result = await checkPassword('wrong', 'hash');

      expect(result).toBe(false);
    });
  });
});
