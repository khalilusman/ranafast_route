import { useState } from "react";
import { Trash2, Download } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export default function LearnedMappingsManager() {
  const [selectedRoute, setSelectedRoute] = useState<number | null>(null);

  const { data: routes = [] } = trpc.routes.list.useQuery();
  const utils = trpc.useUtils();

  const { data: mappings = [], isLoading } = trpc.corrections.listForRoute.useQuery(
    { routeId: selectedRoute ?? 0 },
    { enabled: selectedRoute !== null }
  );

  const invalidateMappings = () => {
    if (selectedRoute !== null) {
      utils.corrections.listForRoute.invalidate({ routeId: selectedRoute });
    }
  };

  const deleteMutation = trpc.corrections.delete.useMutation({
    onSuccess: invalidateMappings,
  });
  const clearMutation = trpc.corrections.clearForRoute.useMutation({
    onSuccess: invalidateMappings,
  });

  const handleDeleteMapping = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ id });
      toast.success("Mapping deleted");
    } catch (err) {
      console.error("[LearnedMappingsManager] Failed to delete mapping:", err);
      toast.error("Failed to delete mapping");
    }
  };

  const handleClearAll = async () => {
    if (!selectedRoute) return;
    if (!confirm("Clear all learned mappings for this route? This cannot be undone.")) return;

    try {
      await clearMutation.mutateAsync({ routeId: selectedRoute });
      toast.success("All mappings cleared");
    } catch (err) {
      console.error("[LearnedMappingsManager] Failed to clear mappings:", err);
      toast.error("Failed to clear mappings");
    }
  };

  const handleExport = () => {
    if (mappings.length === 0) {
      toast.error("No mappings to export");
      return;
    }

    try {
      const json = JSON.stringify(
        {
          routeId: selectedRoute,
          routeName: routes.find(r => r.id === selectedRoute)?.name,
          exportedAt: new Date().toISOString(),
          totalMappings: mappings.length,
          mappings,
        },
        null,
        2
      );

      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `learned-mappings-${selectedRoute}-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Exported learned mappings");
    } catch (err) {
      console.error("[LearnedMappingsManager] Export failed:", err);
      toast.error("Failed to export mappings");
    }
  };

  return (
    <div className="space-y-6">
      {/* Route Selection */}
      <div className="p-6 bg-card rounded-lg border border-border">
        <label className="block text-sm font-semibold text-foreground mb-2">
          Select Route
        </label>
        <select
          value={selectedRoute || ""}
          onChange={e => setSelectedRoute(e.target.value ? parseInt(e.target.value) : null)}
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

      {selectedRoute && (
        <>
          {/* Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-card rounded-lg border border-border">
              <div className="text-sm text-muted-foreground">Total Mappings</div>
              <div className="text-3xl font-bold text-foreground mt-2">{mappings.length}</div>
            </div>

            <div className="p-4 bg-card rounded-lg border border-border">
              <div className="text-sm text-muted-foreground">Total Confirmations</div>
              <div className="text-3xl font-bold text-foreground mt-2">
                {mappings.reduce((sum, m) => sum + m.confirmationCount, 0)}
              </div>
            </div>

            <div className="p-4 bg-card rounded-lg border border-border">
              <div className="text-sm text-muted-foreground">Avg Confidence</div>
              <div className="text-3xl font-bold text-foreground mt-2">
                {mappings.length > 0
                  ? (
                      (mappings.reduce(
                        (sum, m) => sum + Math.min(0.5 + m.confirmationCount * 0.1, 0.85),
                        0
                      ) /
                        mappings.length) *
                      100
                    ).toFixed(0)
                  : 0}
                %
              </div>
            </div>
          </div>

          {/* Mappings Table */}
          {isLoading ? (
            <div className="p-6 bg-card rounded-lg border border-border text-center text-muted-foreground">
              Loading mappings...
            </div>
          ) : mappings.length === 0 ? (
            <div className="p-6 bg-card rounded-lg border border-border text-center text-muted-foreground">
              No learned mappings for this route yet
            </div>
          ) : (
            <div className="p-6 bg-card rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-foreground">
                      Normalized Transcript
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">
                      Original
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">
                      Stop ID
                    </th>
                    <th className="text-center py-3 px-4 font-semibold text-foreground">
                      Confirmations
                    </th>
                    <th className="text-center py-3 px-4 font-semibold text-foreground">
                      Confidence
                    </th>
                    <th className="text-center py-3 px-4 font-semibold text-foreground">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map(mapping => (
                    <tr key={mapping.id} className="border-b border-border hover:bg-muted/50">
                      <td className="py-3 px-4 font-mono text-xs text-foreground">
                        {mapping.normalizedTranscript}
                      </td>
                      <td className="py-3 px-4 text-foreground">{mapping.originalTranscript}</td>
                      <td className="py-3 px-4 text-foreground">{mapping.stopId}</td>
                      <td className="py-3 px-4 text-center text-foreground">
                        {mapping.confirmationCount}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-accent"
                              style={{ width: `${Math.min(0.5 + mapping.confirmationCount * 0.1, 0.85) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {(Math.min(0.5 + mapping.confirmationCount * 0.1, 0.85) * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => handleDeleteMapping(mapping.id)}
                          className="p-2 hover:bg-destructive/10 rounded-lg transition-colors text-destructive"
                          title="Delete mapping"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Action Buttons */}
          {mappings.length > 0 && (
            <div className="flex gap-3">
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 transition-colors"
              >
                <Download size={16} />
                Export Mappings
              </button>

              <button
                onClick={handleClearAll}
                className="flex items-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors ml-auto"
              >
                <Trash2 size={16} />
                Clear All
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
