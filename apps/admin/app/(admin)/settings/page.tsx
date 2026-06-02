const settingsSections = [
  {
    title: "Authentication",
    description: "Better Auth providers, sessions, and platform roles will be configured here.",
  },
  {
    title: "API access",
    description: "Global API defaults and organization-owned key policy will be surfaced here.",
  },
  {
    title: "Desktop phone-home policy",
    description: "Minimum Kira version and access-check behavior will be managed here.",
  },
  {
    title: "Danger zone",
    description: "Irreversible hosted admin actions will be isolated in this section.",
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Admin configuration</p>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </div>
      <section className="grid gap-4 lg:grid-cols-2">
        {settingsSections.map((section) => (
          <article
            key={section.title}
            className="rounded-xl border border-border bg-card p-4 text-card-foreground"
          >
            <h2 className="font-medium">{section.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{section.description}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
