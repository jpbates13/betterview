import AccountBalancesSection from '../components/networth/AccountBalancesSection';
import NetWorthHistorySection from '../components/networth/NetWorthHistorySection';
import { PageHeader } from '../components/planning/ui';

export default function NetWorth() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 min-w-0">
      <PageHeader title="Net worth" description="Snapshots pasted from Fidelity Full View, older totals, and account balances." />
      <NetWorthHistorySection />
      <AccountBalancesSection />
    </div>
  );
}
