import { applyAction } from '$app/forms';

type ConsentActionResult =
  | { type: 'redirect'; location: string }
  | { type: string };

export const handleOAuthConsentResult = async (
  result: ConsentActionResult,
  navigate: (location: string) => void = (location) => window.location.assign(location)
) => {
  if (result.type === 'redirect') {
    navigate(result.location);
    return;
  }

  await applyAction(result as Parameters<typeof applyAction>[0]);
};
