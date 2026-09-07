import { useState } from "react";
import { BarChart3, Settings, Zap, TrendingUp, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import FieldTestingDashboard from "@/components/FieldTestingDashboard";
import LearnedMappingsManager from "@/components/LearnedMappingsManager";
import RouteIntelligenceConfig from "@/components/RouteIntelligenceConfig";
import SystemAnalytics from "@/components/SystemAnalytics";

type TabType = "field-testing" | "learned-mappings" | "ri-config" | "analytics";

export default function AdminPanel() {
  const { user, loading: authLoading } = useAuth({ redirectOnUnauthenticated: true });
  const [activeTab, setActiveTab] = useState<TabType>("field-testing");
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const { data: routes = [] } = trpc.routes.list.useQuery();

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  const tabs: Array<{
    id: TabType;
    label: string;
    icon: React.ReactNode;
    description: string;
  }> = [
    {
      id: "field-testing",
      label: "Field Testing",
      icon: <BarChart3 size={20} />,
      description: "Monitor Route Intelligence performance metrics",
    },
    {
      id: "learned-mappings",
      label: "Learned Mappings",
      icon: <Zap size={20} />,
      description: "Manage speech recognition corrections",
    },
    {
      id: "ri-config",
      label: "Route Intelligence",
      icon: <Settings size={20} />,
      description: "Configure search engine settings",
    },
    {
      id: "analytics",
      label: "System Analytics",
      icon: <TrendingUp size={20} />,
      description: "View cross-route statistics",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-foreground">Admin Panel</h1>
          <p className="text-muted-foreground mt-1">
            Manage Route Intelligence, field testing, and system configuration
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-border bg-background sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? "border-accent text-accent font-semibold"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                title={tab.description}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === "field-testing" && (
          <div>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-foreground">Field Testing Dashboard</h2>
              <p className="text-muted-foreground mt-1">
                Monitor Route Intelligence performance during live testing
              </p>
            </div>
            <div className="p-6 bg-card rounded-lg border border-border mb-6">
              <label className="block text-sm font-semibold text-foreground mb-2">
                Select Route
              </label>
              <select
                value={selectedRouteId ?? ""}
                onChange={e => setSelectedRouteId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground"
              >
                <option value="">Choose a route...</option>
                {routes.map(route => (
                  <option key={route.id} value={route.id}>
                    {route.name}
                  </option>
                ))}
              </select>
            </div>
            {selectedRouteId ? (
              <FieldTestingDashboard routeId={selectedRouteId} hoursAgo={24} />
            ) : (
              <div className="p-6 bg-muted rounded-lg text-center text-muted-foreground">
                Select a route above to view its field testing data.
              </div>
            )}
          </div>
        )}

        {activeTab === "learned-mappings" && (
          <div>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-foreground">Learned Mappings Management</h2>
              <p className="text-muted-foreground mt-1">
                View, edit, and delete learned speech recognition corrections per route
              </p>
            </div>
            <LearnedMappingsManager />
          </div>
        )}

        {activeTab === "ri-config" && (
          <div>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-foreground">Route Intelligence Configuration</h2>
              <p className="text-muted-foreground mt-1">
                Configure search engine behavior, thresholds, and feature flags
              </p>
            </div>
            <RouteIntelligenceConfig />
          </div>
        )}

        {activeTab === "analytics" && (
          <div>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-foreground">System Analytics</h2>
              <p className="text-muted-foreground mt-1">
                View cross-route statistics and performance metrics
              </p>
            </div>
            <SystemAnalytics />
          </div>
        )}
      </div>
    </div>
  );
}
