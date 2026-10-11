import BackupSection from '../components/data/BackupSection';
import DriveBackupsSection from '../components/data/DriveBackupsSection';
import ImportHistorySection from '../components/data/ImportHistorySection';
import CsvProfilesSection from '../components/data/CsvProfilesSection';
import MerchantRulesSection from '../components/data/MerchantRulesSection';
import DuplicatesSection from '../components/data/DuplicatesSection';
import YearReviewSection from '../components/data/YearReviewSection';
import { PageHeader } from '../components/planning/ui';

export default function DataSettings() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 min-w-0">
      <PageHeader title="Data" description="Backups, import history, cleanup and yearly exports." />
      <BackupSection />
      <DriveBackupsSection />
      <YearReviewSection />
      <DuplicatesSection />
      <ImportHistorySection />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <MerchantRulesSection />
        <CsvProfilesSection />
      </div>
    </div>
  );
}
