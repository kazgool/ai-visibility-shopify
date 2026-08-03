import { describe, expect, it } from "vitest";
import { buildQuestions } from "../summary";

const base = {
  title: "Coltar Chesterfield",
  descriptionHtml: "",
  facts: [{ k: "Material", v: "catifea" }],
};

describe("commercial questions (WP 1.6.7/1.6.9 port)", () => {
  it("asks about delivery, returns, warranty and payment when the merchant answered", () => {
    const qas = buildQuestions({
      ...base,
      business: {
        deliveryTime: "2-4 working days",
        deliveryCost: "25 RON",
        deliveryCostIsFrom: true,
        returnDays: 14,
        warranty: "24 months",
        paymentMethods: "card, cash on delivery",
      },
    });
    const questions = qas.map((q) => q.q);
    expect(questions).toContain("How long does delivery take for Coltar Chesterfield?");
    expect(qas.find((q) => q.q.startsWith("How long"))!.a).toBe(
      "2-4 working days. Delivery costs from 25 RON.",
    );
    expect(qas.find((q) => q.q.startsWith("Can I return"))!.a).toBe("Yes, within 14 days.");
    expect(questions).toContain("What warranty does Coltar Chesterfield have?");
    expect(questions).toContain("How can I pay?");
  });

  it("publishes no delivery question when delivery varies by product", () => {
    const qas = buildQuestions({
      ...base,
      business: { deliveryTime: "2-4 working days", deliveryVaries: true, returnDays: 14 },
    });
    expect(qas.map((q) => q.q).join(" ")).not.toContain("delivery");
    expect(qas.map((q) => q.q).join(" ")).toContain("return");
  });

  it("publishes nothing commercial when nothing was filled in", () => {
    const qas = buildQuestions({ ...base, business: {} });
    const joined = qas.map((q) => q.q).join(" ");
    expect(joined).not.toContain("delivery");
    expect(joined).not.toContain("return");
    expect(joined).not.toContain("warranty");
    expect(joined).not.toContain("pay");
  });

  it("never emits a question with an empty answer", () => {
    const qas = buildQuestions({
      ...base,
      business: { deliveryTime: "", warranty: "", paymentMethods: "" },
    });
    for (const qa of qas) expect(qa.a.trim()).not.toBe("");
  });
});
