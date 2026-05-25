import { describe, expect, test } from 'bun:test';
import { indicatorStyle, styleFor } from '../notificationStyles';

describe('notificationStyles.styleFor', () => {
  test('each event type has a distinct color', () => {
    const colors = [
      styleFor('permission').color,
      styleFor('userInput').color,
      styleFor('elicitation').color,
      styleFor('thinking').color,
      styleFor('unseenActivity').color,
    ];
    const unique = new Set(colors);
    expect(unique.size).toBe(5);
  });

  test('each event type has a distinct icon', () => {
    const icons = [
      styleFor('permission').iconSuffix,
      styleFor('userInput').iconSuffix,
      styleFor('elicitation').iconSuffix,
      styleFor('thinking').iconSuffix,
      styleFor('unseenActivity').iconSuffix,
    ];
    const unique = new Set(icons);
    expect(unique.size).toBe(5);
  });

  test('blocking pending kinds pulse; thinking + unseenActivity do NOT', () => {
    expect(styleFor('permission').pulse).toBe(true);
    expect(styleFor('userInput').pulse).toBe(true);
    expect(styleFor('elicitation').pulse).toBe(true);
    // 'thinking' uses pi-spin internally (self-animating spinner),
    // so it doesn't also pulse-fade. 'unseenActivity' stays calm
    // because it's not blocking.
    expect(styleFor('thinking').pulse).toBe(false);
    expect(styleFor('unseenActivity').pulse).toBe(false);
  });

  test('thinking style is the spin-spinner pi class', () => {
    expect(styleFor('thinking').iconSuffix).toContain('spin');
    expect(styleFor('thinking').iconSuffix).toContain('pi-spinner');
  });
});

describe('notificationStyles.indicatorStyle', () => {
  test('pendingRequest beats thinking and unseenTurns', () => {
    const style = indicatorStyle('permission', true, 5);
    expect(style?.iconSuffix).toBe('shield');
  });

  test('thinking beats unseenTurns when no pending request', () => {
    const style = indicatorStyle(null, true, 5);
    expect(style?.iconSuffix).toContain('pi-spinner');
  });

  test("falls back to 'unseenActivity' when only turns are unseen", () => {
    const style = indicatorStyle(null, false, 3);
    expect(style?.iconSuffix).toBe('circle-fill');
    expect(style?.pulse).toBe(false);
  });

  test('returns null when nothing is happening', () => {
    expect(indicatorStyle(null, false, 0)).toBeNull();
  });

  test('each pending request type produces a distinct style', () => {
    const perm = indicatorStyle('permission', false, 0)!;
    const inp = indicatorStyle('userInput', false, 0)!;
    const eli = indicatorStyle('elicitation', false, 0)!;
    expect(perm.color).not.toBe(inp.color);
    expect(inp.color).not.toBe(eli.color);
    expect(perm.color).not.toBe(eli.color);
  });
});
