export interface PastelSwatch {
  id: string;
  label: string;
  labelFr: string;
  bg: string;       // Soft pastel fill
  bgHover: string;  // Slightly richer hover fill
  border: string;   // Crisp muted border
  swatch: string;   // Saturated enough for 10x10 / 12x12 color swatch
  text: string;     // High-contrast ink color (WCAG AAA/AA on bg)
}

export const PASTEL_PALETTE: PastelSwatch[] = [
  {
    id: 'sage',
    label: 'Sage',
    labelFr: 'Sauge',
    bg: '#D3EBD5',
    bgHover: '#C1E2C4',
    border: '#8BC591',
    swatch: '#4FA358',
    text: '#132A16',
  },
  {
    id: 'sky',
    label: 'Powder Blue',
    labelFr: 'Bleu pastel',
    bg: '#CFE4FA',
    bgHover: '#BBD8F7',
    border: '#84B7EE',
    swatch: '#3E8CE0',
    text: '#10243C',
  },
  {
    id: 'ochre',
    label: 'Pale Ochre',
    labelFr: 'Ocre pâle',
    bg: '#FDE7BA',
    bgHover: '#FCDBA0',
    border: '#EBB765',
    swatch: '#D88E24',
    text: '#382208',
  },
  {
    id: 'rose',
    label: 'Dusty Rose',
    labelFr: 'Rose poudré',
    bg: '#FAD4DA',
    bgHover: '#F6BFC8',
    border: '#EA909E',
    swatch: '#DA566C',
    text: '#3D121A',
  },
  {
    id: 'lavender',
    label: 'Lavender',
    labelFr: 'Lavande',
    bg: '#E4DAFB',
    bgHover: '#D6C7F8',
    border: '#B49BF0',
    swatch: '#835EE0',
    text: '#20143F',
  },
  {
    id: 'mint',
    label: 'Seafoam',
    labelFr: 'Menthe douce',
    bg: '#C9EFE8',
    bgHover: '#B3E7DE',
    border: '#72CFC0',
    swatch: '#27A694',
    text: '#0E2E29',
  },
  {
    id: 'apricot',
    label: 'Apricot',
    labelFr: 'Abricot',
    bg: '#FCDCCB',
    bgHover: '#FACBB3',
    border: '#ED9F7A',
    swatch: '#DF6D3C',
    text: '#3D190A',
  },
  {
    id: 'periwinkle',
    label: 'Periwinkle',
    labelFr: 'Pervenche',
    bg: '#D5DCFA',
    bgHover: '#C0CAF7',
    border: '#90A2EE',
    swatch: '#556EE0',
    text: '#131B3E',
  },
  {
    id: 'lemon',
    label: 'Citron',
    labelFr: 'Citron',
    bg: '#F4F3BA',
    bgHover: '#ECEA9E',
    border: '#D6D25C',
    swatch: '#B4AD24',
    text: '#2C2A07',
  },
  {
    id: 'blush',
    label: 'Mauve',
    labelFr: 'Mauve',
    bg: '#F5D5F0',
    bgHover: '#EEC0E7',
    border: '#D994CE',
    swatch: '#C258B2',
    text: '#361230',
  },
  {
    id: 'ice',
    label: 'Glacier',
    labelFr: 'Glacier',
    bg: '#CBEBF5',
    bgHover: '#B3E1EF',
    border: '#78C5DC',
    swatch: '#2D9EC0',
    text: '#0E2B35',
  },
  {
    id: 'sand',
    label: 'Warm Sand',
    labelFr: 'Sable chaud',
    bg: '#EDE1CE',
    bgHover: '#E3D1B6',
    border: '#C9AE84',
    swatch: '#A4824E',
    text: '#2D2212',
  },
];

export function getTaskSwatch(colorId: string): PastelSwatch {
  return PASTEL_PALETTE.find((c) => c.id === colorId) ?? PASTEL_PALETTE[0];
}

export function getSwatchLabel(swatch: PastelSwatch, lang: 'en' | 'fr'): string {
  return lang === 'fr' ? swatch.labelFr : swatch.label;
}

export function pickNextAvailableColorId(usedColorIds: string[]): string {
  const counts = new Map<string, number>();
  for (const p of PASTEL_PALETTE) {
    counts.set(p.id, 0);
  }
  for (const id of usedColorIds) {
    if (counts.has(id)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  let bestId = PASTEL_PALETTE[0].id;
  let minCount = Infinity;
  for (const p of PASTEL_PALETTE) {
    const count = counts.get(p.id) ?? 0;
    if (count < minCount) {
      minCount = count;
      bestId = p.id;
    }
  }
  return bestId;
}
