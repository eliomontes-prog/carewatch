// Tests for requireAuth middleware
import { jest } from '@jest/globals';

const mockVerify = jest.fn();
jest.unstable_mockModule('../services/auth.js', () => ({
  verifyToken: mockVerify,
}));

const { requireAuth } = await import('../middleware/requireAuth.js');

describe('requireAuth Middleware', () => {
  function createMockReqRes({ cookies = {}, authorization } = {}) {
    const req = {
      cookies,
      headers: authorization ? { authorization } : {},
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();
    return { req, res, next };
  }

  beforeEach(() => jest.clearAllMocks());

  it('should extract token from cookie and set req.user', () => {
    const decoded = { id: 'user-1', role: 'admin' };
    mockVerify.mockReturnValue(decoded);
    const { req, res, next } = createMockReqRes({ cookies: { token: 'valid-jwt' } });

    requireAuth(req, res, next);

    expect(mockVerify).toHaveBeenCalledWith('valid-jwt');
    expect(req.user).toEqual(decoded);
    expect(next).toHaveBeenCalled();
  });

  it('should extract token from Bearer header', () => {
    const decoded = { id: 'user-2', role: 'caregiver' };
    mockVerify.mockReturnValue(decoded);
    const { req, res, next } = createMockReqRes({ authorization: 'Bearer header-jwt' });

    requireAuth(req, res, next);

    expect(mockVerify).toHaveBeenCalledWith('header-jwt');
    expect(req.user).toEqual(decoded);
    expect(next).toHaveBeenCalled();
  });

  it('should prefer cookie over Bearer header', () => {
    mockVerify.mockReturnValue({ id: 'user-1' });
    const { req, res, next } = createMockReqRes({
      cookies: { token: 'cookie-jwt' },
      authorization: 'Bearer header-jwt',
    });

    requireAuth(req, res, next);

    expect(mockVerify).toHaveBeenCalledWith('cookie-jwt');
  });

  it('should return 401 when no token is provided', () => {
    const { req, res, next } = createMockReqRes();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
  });

  it('should return 401 when token is invalid', () => {
    mockVerify.mockImplementation(() => { throw new Error('jwt malformed'); });
    const { req, res, next } = createMockReqRes({ cookies: { token: 'bad-token' } });

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired session' });
  });
});
