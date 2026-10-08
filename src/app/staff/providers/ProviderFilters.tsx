import { providersHref, type ProviderFilter, type ProviderQuery } from "./filters";

export interface ProviderFiltersLabels {
  /** The tabs' accessible name: "Filter providers". */
  filters: string;
  filterAll: string;
  filterToConfirm: string;
  filterHidden: string;
  /** The search field's label: "Search by name or code". */
  search: string;
  searchSubmit: string;
  clearSearch: string;
}

/**
 * The top of the Providers list: the filter tabs "All 99 · To confirm 0 · Hidden 0" (links, the current one aria-current="page") and the
 * search by name or code (a GET form). Both are a query of the page, so they work before the page is hydrated and without scripts; the
 * tabs keep the search and the search keeps the tab.
 */
export function ProviderFilters({ query, counts, labels }: { query: ProviderQuery; counts: Record<ProviderFilter, number>; labels: ProviderFiltersLabels }) {
  const tabs: [ProviderFilter, string][] = [
    ["all", labels.filterAll],
    ["confirm", labels.filterToConfirm],
    ["hidden", labels.filterHidden],
  ];
  return (
    <div className="provider-filters">
      <nav aria-label={labels.filters}>
        <ul className="provider-tabs" data-testid="provider-tabs">
          {tabs.map(([filter, label]) => (
            <li key={filter}>
              <a
                className="provider-tab tap"
                href={providersHref({ filter, q: query.q })}
                aria-current={query.filter === filter ? "page" : undefined}
                data-testid={`provider-tab-${filter}`}
              >
                {label} <span className="provider-tab__count">{counts[filter]}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <form className="provider-search" method="get" action="/staff/providers" role="search" data-testid="provider-search">
        {query.filter === "all" ? null : <input type="hidden" name="filter" value={query.filter} />}
        <label htmlFor="provider-search" className="provider-search__label">
          {labels.search}
        </label>
        <div className="provider-search__row">
          <input className="hub-input provider-search__input" id="provider-search" name="q" type="search" defaultValue={query.q} autoComplete="off" spellCheck={false} />
          <button className="hub-button hub-button--secondary" type="submit">
            {labels.searchSubmit}
          </button>
        </div>
        {query.q === "" ? null : (
          <a className="hub-link tap" href={providersHref({ filter: query.filter, q: "" })} data-testid="provider-search-clear">
            {labels.clearSearch}
          </a>
        )}
      </form>
    </div>
  );
}
