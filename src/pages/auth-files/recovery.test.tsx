import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import i18n from "@/i18n";
import type { AuthFile } from "@/lib/types";
import { StatusCell } from "./dialogs";
import { RenewalDetails } from "./recovery";

test("renders a sign-in warning for a still-active credential", async () => {
  await i18n.changeLanguage("en");
  const target: AuthFile = {
    id: "a",
    name: "a.json",
    status: "active",
    requires_sign_in: true,
    renewal_state: "sign_in_required",
    recovery_stage: "sign_in_required",
    refresh_error: { code: "invalid_grant", message: "Refresh grant expired", http_status: 401 },
  };
  expect(renderToStaticMarkup(<StatusCell file={target} />)).toContain("Sign-in required");
  const details = renderToStaticMarkup(<RenewalDetails target={target} />);
  expect(details).toContain("Sign-in required (token not yet expired)");
  expect(details).toContain("invalid_grant / 401 / Refresh grant expired");
  expect(details).toContain("this CPA instance");
});

test("does not conflate successful inference with verified renewal", async () => {
  await i18n.changeLanguage("en");
  const details = renderToStaticMarkup(
    <RenewalDetails
      target={{
        id: "a",
        name: "a.json",
        renewal_state: "awaiting_first_renewal",
        recovery_stage: "inference_verified",
        inference_verified: true,
        renewal_verified: false,
      }}
    />,
  );
  expect(details).toContain("Inference verified");
  expect(details).toContain("Awaiting first automatic renewal");
  expect(details).not.toContain("Automatic renewal verified");
  expect(renderToStaticMarkup(<RenewalDetails target={{ id: "b", name: "b.json" }} />)).toBe("");
});
