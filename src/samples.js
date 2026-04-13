import { defaultBaseline } from './assumptions';

export const sampleCases = [
  {
    id: 'nvidia-10k-2026',
    label: 'NVIDIA 10-K',
    description: 'Public SEC filing example, filed February 25, 2026.',
    company: 'NVIDIA Corporation',
    filingType: '10-K',
    filingDate: '2026-02-25',
    filing: {
      inputMode: 'url',
      url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm',
      title: 'NVIDIA Corporation Annual Report on Form 10-K',
      text: '',
    },
    baseline: {
      ...defaultBaseline,
      companyName: 'NVIDIA Corporation',
    },
  },
];
