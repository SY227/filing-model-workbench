import { defaultBaseline } from './assumptions';

export const sampleCases = [
  {
    id: 'apple-10q-2026',
    label: 'Apple 10-Q',
    description: 'Public SEC filing example, filed January 30, 2026.',
    company: 'Apple Inc.',
    filingType: '10-Q',
    filingDate: '2026-01-30',
    filing: {
      inputMode: 'url',
      url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000006/aapl-20251227.htm',
      title: 'Apple Inc. Quarterly Report on Form 10-Q',
      text: '',
    },
    baseline: {
      ...defaultBaseline,
      companyName: 'Apple Inc.',
    },
  },
  {
    id: 'microsoft-10q-2026',
    label: 'Microsoft 10-Q',
    description: 'Public SEC filing example, filed January 28, 2026.',
    company: 'Microsoft Corporation',
    filingType: '10-Q',
    filingDate: '2026-01-28',
    filing: {
      inputMode: 'url',
      url: 'https://www.sec.gov/Archives/edgar/data/789019/000119312526027207/msft-20251231.htm',
      title: 'Microsoft Corporation Quarterly Report on Form 10-Q',
      text: '',
    },
    baseline: {
      ...defaultBaseline,
      companyName: 'Microsoft Corporation',
    },
  },
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
