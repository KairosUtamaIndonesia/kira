import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { useOnboardingStore } from "../state/onboardingStore";
import { ModeStep } from "./steps/ModeStep";
import { SoundStep } from "./steps/SoundStep";
import { ThemeStep } from "./steps/ThemeStep";

const onboardingSteps = ["mode", "sound", "theme"] as const;
type OnboardingStep = (typeof onboardingSteps)[number];

const stepCopy: Record<OnboardingStep, { title: string; description: string }> = {
  mode: {
    title: "Choose how you'll work",
    description:
      "Kira has two layouts for the same workspace. You can switch anytime from the sidebar.",
  },
  sound: {
    title: "Pick a notification sound",
    description: "Kira plays this when an agent finishes or needs your input.",
  },
  theme: {
    title: "Choose your theme",
    description: "Set the look that suits your room. Change it later in Settings → Appearance.",
  },
};

// Quick-start wizard shown once after first sign-in. It is a controlled modal
// mounted alongside the Shell rather than a gate that swaps it out: every choice
// persists immediately through the feature's own store/provider, so dismissing at
// any point keeps what was already chosen. "Replay quick start" in Settings flips
// the completion flag, which reopens this modal over whatever is showing.
function OnboardingWizard() {
  const completed = useOnboardingStore((state) => state.completed);
  const complete = useOnboardingStore((state) => state.complete);
  const [step, setStep] = useState<OnboardingStep>("mode");

  // Reset to the first step whenever the wizard opens (first run or a replay).
  useEffect(() => {
    if (!completed) {
      setStep("mode");
    }
  }, [completed]);

  const stepIndex = onboardingSteps.indexOf(step);
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === onboardingSteps.length - 1;

  return (
    <Dialog
      open={!completed}
      onOpenChange={(open) => {
        if (!open) {
          complete();
        }
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{stepCopy[step].title}</DialogTitle>
          <DialogDescription>{stepCopy[step].description}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center gap-1.5">
          <span className="sr-only">{`Step ${stepIndex + 1} of ${onboardingSteps.length}`}</span>
          {onboardingSteps.map((stepId, index) => (
            <span
              key={stepId}
              aria-hidden="true"
              className={cn(
                "h-1.5 rounded-full transition-all",
                index === stepIndex ? "w-6 bg-primary" : "w-1.5 bg-border",
              )}
            />
          ))}
        </div>

        <div className="py-1">{renderStep(step)}</div>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={complete}>
            Skip
          </Button>
          <div className="flex gap-2">
            {isFirstStep ? undefined : (
              <Button
                variant="outline"
                onClick={() => {
                  const previousStep = onboardingSteps[stepIndex - 1];
                  if (previousStep !== undefined) {
                    setStep(previousStep);
                  }
                }}
              >
                Back
              </Button>
            )}
            <Button
              onClick={() => {
                // No next step means we are on the final step: finish the wizard.
                const nextStep = onboardingSteps[stepIndex + 1];
                if (nextStep === undefined) {
                  complete();
                  return;
                }

                setStep(nextStep);
              }}
            >
              {isLastStep ? "Finish" : "Continue"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function renderStep(step: OnboardingStep) {
  switch (step) {
    case "mode":
      return <ModeStep />;
    case "sound":
      return <SoundStep />;
    case "theme":
      return <ThemeStep />;
    default:
      throw new Error(`Unknown onboarding step: ${step satisfies never}`);
  }
}

export { OnboardingWizard };
