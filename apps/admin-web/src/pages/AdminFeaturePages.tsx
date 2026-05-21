import { AdminPage, type AdminFeatureRoute } from '../../../web/src/pages/AdminPage';
import {
  AuditTemplatesPage as RoutedAuditTemplatesPage,
  ChecklistTemplatesPage as RoutedChecklistTemplatesPage,
  ComplianceSettingsPage as RoutedComplianceSettingsPage
} from './ComplianceSetupPages';

// Admin features should live on their own route. Do not add new major admin workflows to the overview page.
function RoutedAdminPage({ route }: { route: AdminFeatureRoute }) {
  return <AdminPage standalone route={route} />;
}

export function AdminOverviewPage() {
  return <RoutedAdminPage route="overview" />;
}

export function GeneralSettingsPage() {
  return <RoutedAdminPage route="settings" />;
}

export function VenuesPage() {
  return <RoutedAdminPage route="venues" />;
}

export function UsersPage() {
  return <RoutedAdminPage route="users" />;
}

export function RolesPage() {
  return <RoutedAdminPage route="roles" />;
}

export function StaffSettingsPage() {
  return <RoutedAdminPage route="staff-settings" />;
}

export function StaffRecordTypesPage() {
  return <RoutedAdminPage route="staff-record-types" />;
}

export function StaffOnboardingPage() {
  return <RoutedAdminPage route="staff-onboarding" />;
}

export function ComplianceSettingsPage() {
  return <RoutedComplianceSettingsPage />;
}

export function ChecklistTemplatesPage() {
  return <RoutedChecklistTemplatesPage />;
}

export function ShiftTaskRulesPage() {
  return <RoutedAdminPage route="shift-task-rules" />;
}

export function AuditTemplatesPage() {
  return <RoutedAuditTemplatesPage />;
}

export function IntegrationsPage() {
  return <RoutedAdminPage route="integrations" />;
}

export function XeroIntegrationPage() {
  return <RoutedAdminPage route="xero" />;
}

export function ImportsPage() {
  return <RoutedAdminPage route="imports" />;
}

export function DangerZonePage() {
  return <RoutedAdminPage route="danger-zone" />;
}

export function HumanAgentDemoPage() {
  return <RoutedAdminPage route="human-agent-demo" />;
}
