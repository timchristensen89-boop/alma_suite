import { AdminPage, type AdminFeatureRoute } from '../../../web/src/pages/AdminPage';

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
  return <RoutedAdminPage route="compliance-settings" />;
}

export function ChecklistTemplatesPage() {
  return <RoutedAdminPage route="checklist-templates" />;
}

export function ShiftTaskRulesPage() {
  return <RoutedAdminPage route="shift-task-rules" />;
}

export function AuditTemplatesPage() {
  return <RoutedAdminPage route="audit-templates" />;
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
