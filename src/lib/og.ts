import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import type { Entity } from './types';

// Fonts are read from the repo at build time (static endpoint). cwd is the
// project root during `astro build`.
const fontDir = path.join(process.cwd(), 'src/assets/fonts');
const fontBlack = fs.readFileSync(path.join(fontDir, 'BarlowCondensed-Black.ttf'));
const fontSemi = fs.readFileSync(path.join(fontDir, 'BarlowCondensed-SemiBold.ttf'));

const COLOR = {
  canvas: '#0d0d0f',
  ink: '#f0f0f2',
  body: '#8b8b95',
  lime: '#c8ff00',
};

/** Minimal hyperscript for satori (no JSX runtime needed). */
function h(type: string, props: Record<string, unknown>, ...children: unknown[]) {
  return { type, props: { ...props, children: children.length === 1 ? children[0] : children } };
}

const col = (style: Record<string, unknown>, ...children: unknown[]) =>
  h('div', { style: { display: 'flex', flexDirection: 'column', ...style } }, ...children);
const text = (style: Record<string, unknown>, value: string) => h('div', { style: { display: 'flex', ...style } }, value);

/** Render a 1200×630 share image for a battle as a PNG buffer. */
export async function renderBattleOg(a: Entity, b: Entity): Promise<Buffer> {
  const tree = h(
    'div',
    {
      style: {
        width: '1200px',
        height: '630px',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: COLOR.canvas,
        padding: '64px',
        fontFamily: 'Barlow',
        position: 'relative',
      },
    },
    // Brand
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
      text({ fontSize: 28, fontWeight: 900, color: COLOR.ink, letterSpacing: '0.04em' }, 'GOATSBATTLE'),
      text({ fontSize: 22, fontWeight: 600, color: COLOR.body, letterSpacing: '0.18em' }, 'WHO IS THE GOAT?'),
    ),
    // Names split
    h(
      'div',
      { style: { display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', gap: '32px' } },
      col(
        { flex: 1, alignItems: 'flex-start' },
        text({ fontSize: 132, fontWeight: 900, color: COLOR.ink, lineHeight: 1, textTransform: 'uppercase' }, a.shortName),
        text({ fontSize: 30, fontWeight: 600, color: COLOR.body, marginTop: '8px' }, a.nationality),
      ),
      text({ fontSize: 180, fontWeight: 900, color: COLOR.lime, lineHeight: 1 }, '/'),
      col(
        { flex: 1, alignItems: 'flex-end' },
        text({ fontSize: 132, fontWeight: 900, color: COLOR.ink, lineHeight: 1, textTransform: 'uppercase' }, b.shortName),
        text({ fontSize: 30, fontWeight: 600, color: COLOR.body, marginTop: '8px' }, b.nationality),
      ),
    ),
    // Footer strip
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '16px' } },
      h('div', { style: { display: 'flex', width: '48px', height: '8px', backgroundColor: COLOR.lime } }),
      text({ fontSize: 26, fontWeight: 600, color: COLOR.body, letterSpacing: '0.05em' }, 'Compare stats · Cast your vote · See what the world thinks'),
    ),
  );

  const svg = await satori(tree as never, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Barlow', data: fontBlack, weight: 900, style: 'normal' },
      { name: 'Barlow', data: fontSemi, weight: 600, style: 'normal' },
    ],
  });

  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
  return Buffer.from(resvg.render().asPng());
}
