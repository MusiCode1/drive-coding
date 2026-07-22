<script lang="ts">
/**
 * AuthGuidance — פאנל הדרכת-אימות ספציפי-ל-CLI. מוצג מתחת ל-error alert הקיים
 * כשיש error **וגם** authMethods לא-ריק (רק ב-claude, שאין לו authMethods, לא מוצג פאנל —
 * ה-error של formatAcpError מספיק). תצוגה בלבד — בלי authenticate אינטראקטיבי (זה auth-flows).
 *
 * ר' docs/plans/slice-auth-guidance.md §3 Commit 1.
 */
import type { AuthMethod } from "@agentclientprotocol/sdk"
import type { CliKind } from "@drive-coding/core"
import { getI18n } from "$lib/context"
import { describeAuthMethod } from "$lib/util/auth-guidance"

interface Props {
  cliKind: CliKind | null
  authMethods: ReadonlyArray<AuthMethod>
}

const { cliKind, authMethods }: Props = $props()

const i18n = getI18n()
const t = i18n.t

const methods = $derived(authMethods.map(describeAuthMethod))
</script>

{#if methods.length > 0}
  <div class="auth-guidance" role="region" aria-label={t("authGuidance.heading")}>
    <strong dir="auto">{t("authGuidance.heading")}{cliKind ? ` ${cliKind}` : ""}</strong>
    <ul>
      {#each methods as m (m.id)}
        <li>
          <div class="method-name" dir="auto">{m.name}</div>
          {#if m.kind === "env_var"}
            <div class="method-detail" dir="auto">
              {t("authGuidance.envVar.setLabel")} {m.varNames.join(", ")}
            </div>
            {#if m.link}
              <a href={m.link} target="_blank" rel="noopener noreferrer" dir="auto">
                {t("authGuidance.envVar.linkLabel")}
              </a>
            {/if}
          {:else if m.description}
            <div class="method-detail" dir="auto">{m.description}</div>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .auth-guidance {
    margin-top: 0.75rem;
    padding: 0.9rem 1rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 0.9rem;
  }

  ul {
    margin: 0.5rem 0 0;
    padding-inline-start: 1.1rem;
  }

  li {
    margin-bottom: 0.6rem;
  }

  li:last-child {
    margin-bottom: 0;
  }

  .method-name {
    font-weight: 600;
  }

  .method-detail {
    color: var(--fg-dim);
    font-size: 0.85rem;
  }

  a {
    font-size: 0.85rem;
  }
</style>
