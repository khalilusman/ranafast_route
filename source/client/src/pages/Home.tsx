import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { user, loading, refresh } = useAuth();
  const [, navigate] = useLocation();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      navigate("/routes");
    }
  }, [user, loading, navigate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ passcode }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error || "Invalid passcode");
        return;
      }

      await refresh();
      navigate("/routes");
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6">
      <div className="text-center max-w-sm w-full">
        {/* Logo mark */}
        <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center mx-auto mb-4 shadow-lg">
          <span className="text-2xl">📮</span>
        </div>

        <h1
          className="text-3xl font-bold text-primary mb-2"
          style={{ fontFamily: "'Playfair Display', serif" }}
        >
          Maghery Route
        </h1>
        <p className="text-muted-foreground text-sm mb-6">
          An Post delivery route tool for Maghery, Co. Donegal
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            type="password"
            value={passcode}
            onChange={e => setPasscode(e.target.value)}
            placeholder="Enter passcode"
            autoFocus
            className="h-12 text-center rounded-full"
            aria-invalid={Boolean(error)}
          />

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={submitting || !passcode}
            size="lg"
            className="w-full rounded-full shadow"
          >
            {submitting ? "Signing in..." : "Sign in to view route"}
          </Button>
        </form>

        <p className="text-xs text-muted-foreground mt-4">
          Relief postmen — use the share link provided by your supervisor.
        </p>
      </div>
    </div>
  );
}
