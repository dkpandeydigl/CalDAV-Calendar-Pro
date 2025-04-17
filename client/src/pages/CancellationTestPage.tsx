import CancellationTest from "@/components/cancellation-test";

export default function CancellationTestPage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">
        ICS Cancellation Format Fix Testing
      </h1>
      <p className="mb-6 text-muted-foreground">
        This page tests the enhanced ICS formatter for properly handling cancellation emails with organizer issues.
      </p>
      <CancellationTest />
    </div>
  );
}