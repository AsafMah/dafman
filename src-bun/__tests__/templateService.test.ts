import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TemplateService, TEMPLATE_STORE_VERSION } from '../app/config/templateService';
import type { SessionTemplate } from '../rpc';

const TEST_DIR = join(tmpdir(), `dafman-template-svc-test-${Date.now()}`);
const TEST_PATH = join(TEST_DIR, 'session-templates.json');

function makeTemplate(overrides: Partial<SessionTemplate> = {}): SessionTemplate {
  return {
    id: crypto.randomUUID(),
    name: 'Test Template',
    mcpEnabled: [],
    skillsDisabled: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('TemplateService', () => {
  test('loadOrDefault — missing file returns empty service', () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);

    expect(svc.list()).toEqual([]);
  });

  test('loadOrDefault — corrupt file starts empty (warn, no throw)', () => {
    writeFileSync(TEST_PATH, '{ not valid json }', 'utf-8');
    const svc = TemplateService.loadOrDefault(TEST_PATH);

    expect(svc.list()).toEqual([]);
  });

  test('loadOrDefault — valid file parsed correctly', async () => {
    const t = makeTemplate({
      id: 'abc',
      name: 'Prod',
      agentName: 'my-agent',
      runMode: 'autopilot',
    });
    const fileData = {
      version: TEMPLATE_STORE_VERSION,
      templates: [t],
    };

    writeFileSync(TEST_PATH, JSON.stringify(fileData), 'utf-8');
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const list = svc.list();

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('abc');
    expect(list[0].name).toBe('Prod');
    expect(list[0].agentName).toBe('my-agent');
    expect(list[0].runMode).toBe('autopilot');
  });

  test('save — inserts new template and persists', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const t = makeTemplate({ id: 'id1', name: 'Alpha' });

    await svc.save(t);
    expect(svc.list()).toHaveLength(1);
    expect(svc.list()[0].name).toBe('Alpha');

    // Verify on-disk round-trip
    const on_disk = JSON.parse(readFileSync(TEST_PATH, 'utf-8')) as { templates: unknown[] };

    expect(on_disk.templates).toHaveLength(1);
  });

  test('save — update by id keeps position, stamps updatedAt', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const t = makeTemplate({ id: 'id1', name: 'Alpha' });

    await svc.save(t);
    await svc.save({ ...t, name: 'Alpha Renamed' });

    const list = svc.list();

    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Alpha Renamed');
    expect(list[0].id).toBe('id1');
    // updatedAt should be a recent ISO stamp
    expect(list[0].updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  test('save — auto-generates id when absent', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const noId = { ...makeTemplate(), id: '' };

    await svc.save(noId);
    const list = svc.list();

    expect(list).toHaveLength(1);
    expect(list[0].id.length).toBeGreaterThan(0);
  });

  test('delete — removes existing template', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);

    await svc.save(makeTemplate({ id: 't1', name: 'One' }));
    await svc.save(makeTemplate({ id: 't2', name: 'Two' }));
    expect(svc.list()).toHaveLength(2);

    await svc.delete('t1');
    const list = svc.list();

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('t2');
  });

  test('delete — missing id is a no-op (no throw)', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);

    await expect(svc.delete('nonexistent')).resolves.toBeUndefined();
  });

  test('list — returns a copy (mutations do not affect internal state)', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);

    await svc.save(makeTemplate({ id: 'x', name: 'X' }));

    const list = svc.list();

    list.push(makeTemplate({ id: 'inject', name: 'Injected' }));
    expect(svc.list()).toHaveLength(1);
  });

  test('atomic round-trip — save → loadOrDefault → list is stable', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const t1 = makeTemplate({
      id: 'r1',
      name: 'Round',
      mcpEnabled: ['mcp1'],
      skillsDisabled: ['s1'],
      runMode: 'plan',
    });

    await svc.save(t1);

    const svc2 = TemplateService.loadOrDefault(TEST_PATH);
    const list = svc2.list();

    expect(list).toHaveLength(1);
    expect(list[0].mcpEnabled).toEqual(['mcp1']);
    expect(list[0].skillsDisabled).toEqual(['s1']);
    expect(list[0].runMode).toBe('plan');
  });

  test('coerce — strips invalid entries, keeps valid ones', () => {
    const valid = makeTemplate({ id: 'v1', name: 'Valid' });
    const fileData = {
      version: 1,
      templates: [
        valid,
        { id: '', name: 'bad-id' }, // invalid — empty id
        { name: 'no-id' }, // invalid — missing id
        null, // invalid — null
        'string', // invalid — not an object
      ],
    };

    writeFileSync(TEST_PATH, JSON.stringify(fileData), 'utf-8');
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const list = svc.list();

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('v1');
  });

  test('missing file path — directory created on first save', async () => {
    const nestedPath = join(TEST_DIR, 'nested', 'deep', 'session-templates.json');
    const svc = TemplateService.loadOrDefault(nestedPath);

    await svc.save(makeTemplate({ id: 'deep', name: 'Deep' }));
    expect(existsSync(nestedPath)).toBe(true);
  });
});
