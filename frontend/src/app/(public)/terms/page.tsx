import type { Metadata } from "next";

// LEGAL-01: the client PRD's "User compliance and data protection" section,
// reproduced verbatim (docs/MVP_Cient_PRD.docx.md). A static server
// component — no session read, no Supabase call, no client hook, no icon
// import — so the page the client asked to "load instantly" actually does.
// See LEGAL-01 in .planning/REQUIREMENTS.md for the recorded discrepancy
// between this copy's privacy paragraph and this app's real auth/data
// surface; that discrepancy is not corrected here — the copy ships
// unmodified by decision.

export const metadata: Metadata = { title: "Preview Terms & Privacy Policy" };

export default function TermsPage() {
  return (
    <main className="px-6 pt-14 pb-12">
      <h1 className="mb-8 text-[28px] font-semibold tracking-tight text-foreground">
        Preview Terms & Privacy Policy
      </h1>
      <div className="flex flex-col gap-6">
        <section>
          <h2 className="mb-2 text-base font-semibold text-foreground">
            What this is
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            This is an unreleased, experimental preview application built for
            feedback and evaluation purposes only. The system is provided
            &quot;as-is&quot; without any commercial warranties.
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-base font-semibold text-foreground">
            Intellectual Property
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            All code, application layouts, visual designs, workflows, and
            processing logic are strictly proprietary. You agree not to copy,
            reverse-engineer, screenshot, or share the system structure with
            outside parties. Any feedback, ideas, or suggestions you submit
            while using this preview become the exclusive property of the
            platform.
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-base font-semibold text-foreground">
            Your Privacy & Data
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            We only collect the minimal data necessary to run the app - such as
            your email address for authentication and basic usage analytics to
            improve features. We do not track your location, and we will never
            sell or rent your personal data to anyone.
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-base font-semibold text-foreground">
            Accountability
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Because this is an early-stage test, we are not liable for any
            temporary server downtime, loss of test data, or minor system bugs
            that may occur while you look around.
          </p>
        </section>
      </div>
    </main>
  );
}
