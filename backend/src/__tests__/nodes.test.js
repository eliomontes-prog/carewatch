// Tests for node management queries and API logic
import { jest } from '@jest/globals';

const mockDbRun = jest.fn().mockResolvedValue({ rows: [] });
const mockDbGet = jest.fn();
const mockDbAll = jest.fn().mockResolvedValue([]);

jest.unstable_mockModule('../db/pool.js', () => ({
  db: {
    run: mockDbRun,
    get: mockDbGet,
    all: mockDbAll,
    pool: {},
  },
  default: {},
}));

const { nodes } = await import('../db/queries.js');

describe('Node Queries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAll', () => {
    it('should return all nodes ordered by created_at', async () => {
      const mockNodes = [
        { id: 'node-1', label: 'Node A', room: 'bedroom', status: 'online' },
        { id: 'node-2', label: 'Node B', room: 'kitchen', status: 'offline' },
      ];
      mockDbAll.mockResolvedValue(mockNodes);

      const result = await nodes.getAll();

      expect(mockDbAll).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM nodes'));
      expect(result).toEqual(mockNodes);
    });
  });

  describe('getById', () => {
    it('should return a single node by id', async () => {
      const mockNode = { id: 'node-1', label: 'Node A', room: 'bedroom' };
      mockDbGet.mockResolvedValue(mockNode);

      const result = await nodes.getById('node-1');

      expect(mockDbGet).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        ['node-1']
      );
      expect(result).toEqual(mockNode);
    });

    it('should return null for non-existent node', async () => {
      mockDbGet.mockResolvedValue(null);

      const result = await nodes.getById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getByMac', () => {
    it('should find a node by MAC address', async () => {
      const mockNode = { id: 'node-1', mac_address: 'AA:BB:CC:DD:EE:FF' };
      mockDbGet.mockResolvedValue(mockNode);

      const result = await nodes.getByMac('AA:BB:CC:DD:EE:FF');

      expect(mockDbGet).toHaveBeenCalledWith(
        expect.stringContaining('mac_address = $1'),
        ['AA:BB:CC:DD:EE:FF']
      );
      expect(result).toEqual(mockNode);
    });
  });

  describe('getByRoom', () => {
    it('should return all nodes in a room', async () => {
      const mockNodes = [
        { id: 'node-1', label: 'Node A', room: 'bedroom' },
        { id: 'node-2', label: 'Node B', room: 'bedroom' },
      ];
      mockDbAll.mockResolvedValue(mockNodes);

      const result = await nodes.getByRoom('bedroom');

      expect(mockDbAll).toHaveBeenCalledWith(
        expect.stringContaining("WHERE room = $1"),
        ['bedroom']
      );
      expect(result).toHaveLength(2);
    });
  });

  describe('create (upsert)', () => {
    it('should insert a new node with all fields', async () => {
      await nodes.create({
        id: 'node-1',
        label: 'Bedroom Node A',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        ip_address: '192.168.1.100',
        room: 'bedroom',
        position_x: 2.0,
        position_y: 3.0,
        position_z: 1.5,
        firmware_version: '1.0.0',
        status: 'online',
      });

      expect(mockDbRun).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbRun.mock.calls[0];
      expect(sql).toContain('INSERT INTO nodes');
      expect(sql).toContain('ON CONFLICT');
      expect(params[0]).toBe('node-1');
      expect(params[1]).toBe('Bedroom Node A');
      expect(params[2]).toBe('AA:BB:CC:DD:EE:FF');
      expect(params[4]).toBe('bedroom');
    });

    it('should use defaults for optional fields', async () => {
      await nodes.create({
        id: 'node-2',
        label: 'Node B',
      });

      const [, params] = mockDbRun.mock.calls[0];
      expect(params[2]).toBeNull();  // mac_address
      expect(params[3]).toBeNull();  // ip_address
      expect(params[4]).toBe('default');  // room
      expect(params[5]).toBe(0);     // position_x
      expect(params[6]).toBe(0);     // position_y
      expect(params[7]).toBe(1.5);   // position_z
    });
  });

  describe('heartbeat', () => {
    it('should update status to online and set last_heartbeat', async () => {
      await nodes.heartbeat('node-1', '192.168.1.100');

      expect(mockDbRun).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbRun.mock.calls[0];
      expect(sql).toContain("status = 'online'");
      expect(sql).toContain('last_heartbeat = NOW()');
      expect(params).toEqual(['192.168.1.100', 'node-1']);
    });
  });

  describe('recordFrame', () => {
    it('should increment frame count and update last_frame_at', async () => {
      await nodes.recordFrame('node-1');

      expect(mockDbRun).toHaveBeenCalledTimes(1);
      const [sql] = mockDbRun.mock.calls[0];
      expect(sql).toContain('frames_total = frames_total + 1');
      expect(sql).toContain("status = 'online'");
    });
  });

  describe('markStaleOffline', () => {
    it('should mark nodes offline if no heartbeat in N minutes', async () => {
      await nodes.markStaleOffline(2);

      expect(mockDbRun).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbRun.mock.calls[0];
      expect(sql).toContain("status = 'offline'");
      expect(sql).toContain("status = 'online'");
      expect(params).toEqual([2]);
    });
  });

  describe('remove', () => {
    it('should delete a node by id', async () => {
      await nodes.remove('node-1');

      expect(mockDbRun).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM nodes WHERE id = $1'),
        ['node-1']
      );
    });
  });
});
