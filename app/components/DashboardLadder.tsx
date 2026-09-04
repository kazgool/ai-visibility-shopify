// The ladder, laid out. Every ordering, locking and wording decision is made
// in app/services/dashboard-steps.ts; this file places what that returns and
// decides nothing.
//
// It imports Polaris and the pure resolver and nothing else - no Remix, no
// shopify.server - for the same reason SeoSinceCard does: a component that
// imports a router hook cannot be rendered in a test, and the sentences on
// this screen are exactly what has to be asserted on. Actions are handed in as
// callbacks and links as an optional wrapper, so the route supplies client-side
// navigation and the test supplies nothing at all.

import { useState, type ReactNode } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Collapsible,
  Divider,
  Icon,
  InlineGrid,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { CheckIcon, AlertCircleIcon } from "@shopify/polaris-icons";

import {
  CAUSE_SHORT,
  type Ladder,
  type LadderStep,
  type StepAction,
} from "../services/dashboard-steps";

export type LadderProps = {
  ladder: Ladder;
  /** Latest verdict per crawler. Rendered inside step one, behind its result
   *  line - never as eight red tiles on the first fold. */
  crawlers: { agent: string; cause: string }[];
  crawlerRunning: boolean;
  /** A navigation is in flight; every button shows it rather than only the
   *  one that was pressed being able to. */
  busy: boolean;
  /** Post the dashboard action with this `mode`. */
  onJob: (mode: string) => void;
  /** Re-read the loader, which re-verifies the embed against the theme. */
  onRevalidate: () => void;
  /** Client-side navigation when the route supplies it; a plain anchor
   *  otherwise, which is what a test gets. */
  linkTo?: (to: string, children: ReactNode) => ReactNode;
  /** Everything the five steps do not own, reachable and out of the way. */
  everythingElse?: ReactNode;
};

function Anchor({ to, children }: { to: string; children: ReactNode }) {
  return <a href={to}>{children}</a>;
}

function ActionButton({
  action,
  busy,
  onJob,
  onRevalidate,
  linkTo,
  slim,
}: {
  action: StepAction;
  busy: boolean;
  onJob: (mode: string) => void;
  onRevalidate: () => void;
  linkTo?: (to: string, children: ReactNode) => ReactNode;
  slim?: boolean;
}) {
  const variant = action.primary ? ("primary" as const) : undefined;
  const size = slim ? ("slim" as const) : action.primary ? ("large" as const) : undefined;

  const button =
    action.kind === "job" ? (
      <Button
        variant={variant}
        size={size}
        loading={busy && !action.disabled}
        disabled={action.disabled}
        onClick={() => onJob(action.mode ?? "dry")}
      >
        {action.label}
      </Button>
    ) : action.kind === "revalidate" ? (
      <Button variant="plain" onClick={onRevalidate}>
        {action.label}
      </Button>
    ) : action.kind === "external" ? (
      <Button variant={variant} size={size} url={action.url} target="_top" disabled={action.disabled}>
        {action.label}
      </Button>
    ) : action.disabled ? (
      <Button variant={variant} size={size} disabled>
        {action.label}
      </Button>
    ) : (
      (linkTo ?? ((to: string, children: ReactNode) => <Anchor to={to}>{children}</Anchor>))(
        action.to ?? "/app",
        <Button variant={variant} size={size}>
          {action.label}
        </Button>,
      )
    );

  return (
    <BlockStack gap="100">
      <Box>{button}</Box>
      {action.disabled && action.disabledReason ? (
        <Text as="p" variant="bodySm" tone="subdued">
          {action.disabledReason}
        </Text>
      ) : null}
    </BlockStack>
  );
}

/** The crawler verdicts, one tile each, behind a disclosure. Eight red tiles
 *  above the fold on a password-protected pre-launch store is the first thing
 *  a new merchant saw, and every one of them was expected. */
function CrawlerTiles({ crawlers }: { crawlers: { agent: string; cause: string }[] }) {
  const [open, setOpen] = useState(false);
  if (crawlers.length === 0) return null;
  return (
    <BlockStack gap="200">
      <Box>
        <Button
          variant="plain"
          disclosure={open ? "up" : "down"}
          onClick={() => setOpen((v) => !v)}
          ariaExpanded={open}
          ariaControls="ladder-crawler-tiles"
        >
          {open ? "Hide each crawler" : `Show each crawler (${crawlers.length})`}
        </Button>
      </Box>
      <Collapsible open={open} id="ladder-crawler-tiles">
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
          {crawlers.map((c) => (
            <Box
              key={c.agent}
              padding="300"
              borderRadius="200"
              borderWidth="025"
              borderColor="border"
            >
              <BlockStack gap="100">
                <InlineStack gap="100" blockAlign="center" wrap={false}>
                  <Icon
                    source={c.cause === "ok" ? CheckIcon : AlertCircleIcon}
                    tone={c.cause === "ok" ? "success" : "critical"}
                  />
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {c.agent}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {c.cause === "ok" ? "Can read your products" : CAUSE_SHORT[c.cause] ?? c.cause}
                </Text>
              </BlockStack>
            </Box>
          ))}
        </InlineGrid>
      </Collapsible>
    </BlockStack>
  );
}

function StepRow({
  step,
  props,
}: {
  step: LadderStep;
  props: LadderProps;
}) {
  const { busy, onJob, onRevalidate, linkTo, crawlers, crawlerRunning } = props;
  const collapsed = step.status === "done" || step.status === "not_needed";

  // A finished step is one line: a mark, its title, its result. No purpose
  // sentence, no colour beyond the tick, and its action - if it still has one -
  // slim and secondary, so nothing that is already done competes for the eye.
  if (collapsed) {
    return (
      <BlockStack gap="150">
        <InlineStack gap="200" blockAlign="start" wrap={false}>
          <Box paddingBlockStart="050">
            {step.status === "done" ? (
              <Icon source={CheckIcon} tone="success" />
            ) : (
              <Box background="bg-fill-tertiary" borderRadius="full" minHeight="8px" minWidth="8px" />
            )}
          </Box>
          <BlockStack gap="050">
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                {`${step.number}. ${step.title}`}
              </Text>
              {step.status === "not_needed" ? <Badge>Not needed</Badge> : null}
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {step.result ?? ""}
            </Text>
          </BlockStack>
        </InlineStack>
        {step.key === "reach" ? <CrawlerTiles crawlers={crawlers} /> : null}
        {step.action || step.extra ? (
          <InlineStack gap="200">
            {step.action ? (
              <ActionButton
                slim
                action={{ ...step.action, primary: false }}
                busy={busy}
                onJob={onJob}
                onRevalidate={onRevalidate}
                linkTo={linkTo}
              />
            ) : null}
            {step.extra ? (
              <ActionButton
                slim
                action={step.extra}
                busy={busy}
                onJob={onJob}
                onRevalidate={onRevalidate}
                linkTo={linkTo}
              />
            ) : null}
          </InlineStack>
        ) : null}
      </BlockStack>
    );
  }

  const quiet = step.status === "locked";

  return (
    <BlockStack gap="200">
      <InlineStack gap="200" blockAlign="start" wrap={false}>
        <Box paddingBlockStart="050">
          {quiet ? (
            <Box background="bg-fill-tertiary" borderRadius="full" minHeight="8px" minWidth="8px" />
          ) : (
            <Icon source={AlertCircleIcon} tone="caution" />
          )}
        </Box>
        <BlockStack gap="050">
          <Text as="p" variant="bodyMd" fontWeight="semibold" tone={quiet ? "subdued" : undefined}>
            {`${step.number}. ${step.title}`}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {step.purpose}
          </Text>
          {step.result ? (
            <Text as="p" variant="bodySm" tone="subdued">
              {step.result}
            </Text>
          ) : null}
          {step.problem ? (
            <Text as="p" variant="bodySm" tone="subdued">
              {step.problem}
            </Text>
          ) : null}
        </BlockStack>
      </InlineStack>

      {step.key === "reach" && crawlerRunning ? (
        <Text as="p" variant="bodySm" tone="subdued">
          Asking each crawler...
        </Text>
      ) : null}
      {step.key === "reach" ? <CrawlerTiles crawlers={crawlers} /> : null}

      {step.subs.length > 0 ? (
        <BlockStack gap="150">
          {step.subs.map((s) => (
            <InlineStack key={s.label} gap="200" blockAlign="start" wrap={false}>
              <Box paddingBlockStart="050">
                {s.done ? (
                  <Icon source={CheckIcon} tone="success" />
                ) : (
                  <Box
                    background="bg-fill-tertiary"
                    borderRadius="full"
                    minHeight="8px"
                    minWidth="8px"
                  />
                )}
              </Box>
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  {s.label}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {s.hint}
                </Text>
              </BlockStack>
            </InlineStack>
          ))}
        </BlockStack>
      ) : null}

      {step.action || step.extra ? (
        <InlineStack gap="200" blockAlign="center">
          {step.action ? (
            <ActionButton
              action={step.action}
              busy={busy}
              onJob={onJob}
              onRevalidate={onRevalidate}
              linkTo={linkTo}
            />
          ) : null}
          {step.extra ? (
            <ActionButton
              action={step.extra}
              busy={busy}
              onJob={onJob}
              onRevalidate={onRevalidate}
              linkTo={linkTo}
            />
          ) : null}
        </InlineStack>
      ) : null}
    </BlockStack>
  );
}

export function DashboardLadder(props: LadderProps) {
  const { ladder, everythingElse } = props;
  const [elseOpen, setElseOpen] = useState(false);
  const remaining = ladder.steps.filter((s) => s.status === "current" || s.status === "locked").length;

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="050">
          <Text as="h2" variant="headingMd">
            Your path to being read
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {remaining === 0
              ? "All five steps are finished. Nothing here needs you."
              : `Five steps, in this order. ${remaining} still to do; each one says what it is for and only the next one is open.`}
          </Text>
        </BlockStack>

        {ladder.steps.map((step, i) => (
          <BlockStack key={step.key} gap="400">
            {i > 0 ? <Divider /> : null}
            <StepRow step={step} props={props} />
          </BlockStack>
        ))}

        {everythingElse ? (
          <BlockStack gap="300">
            <Divider />
            <Box>
              <Button
                variant="plain"
                disclosure={elseOpen ? "up" : "down"}
                onClick={() => setElseOpen((v) => !v)}
                ariaExpanded={elseOpen}
                ariaControls="ladder-everything-else"
              >
                {elseOpen ? "Hide everything else" : "Everything else"}
              </Button>
            </Box>
            <Collapsible open={elseOpen} id="ladder-everything-else">
              {everythingElse}
            </Collapsible>
          </BlockStack>
        ) : null}
      </BlockStack>
    </Card>
  );
}
