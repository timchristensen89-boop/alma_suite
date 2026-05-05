import { websiteMenuUpdateInputSchema } from '@alma/shared';
import { env } from '../env.js';
import { HttpError } from '../lib/http.js';

type GitHubContentResponse = {
  sha: string;
  html_url?: string;
};

type GitHubCommitResponse = {
  content?: {
    html_url?: string;
    path?: string;
    sha?: string;
  };
  commit?: {
    html_url?: string;
    sha?: string;
  };
};

const defaults: Record<string, {
  title: string;
  location: string;
  image: string;
  foodHref: string;
  drinksHref: string;
  setMenus: Array<{ title: string; price: string }>;
}> = {
  'alma avalon': {
    title: 'Alma Avalon',
    location: 'Avalon Beach',
    image: '/images/alma-avalon-food-menu.jpg',
    foodHref: '/menus/alma-avalon-menu.pdf',
    drinksHref: '/menus/alma-avalon-drinks.pdf',
    setMenus: [
      { title: 'Grazing', price: '49 pp' },
      { title: 'Feasting', price: '79 pp' }
    ]
  },
  'st alma': {
    title: 'St Alma',
    location: 'Freshwater',
    image: '/images/st-alma-food-menu.jpg',
    foodHref: '/menus/st-alma-menu.pdf',
    drinksHref: '/menus/st-alma-drinks.pdf',
    setMenus: [{ title: 'Trust our chef', price: '79 pp' }]
  }
};

function clean(value: string | undefined) {
  return value?.trim() || '';
}

function menuContentFromPayload(input: unknown) {
  const data = websiteMenuUpdateInputSchema.parse(input);
  const menus = data.venues.map((venue) => {
    const fallback = defaults[venue.title.trim().toLowerCase()];
    return {
      title: venue.title.trim(),
      location: clean(venue.location) || fallback?.location || '',
      image: clean(venue.image) || fallback?.image || '',
      foodHref: clean(venue.foodHref) || fallback?.foodHref || '',
      drinksHref: clean(venue.drinksHref) || fallback?.drinksHref || '',
      setMenus: venue.setMenus.length ? venue.setMenus : fallback?.setMenus || [],
      sections: venue.sections.map((section) => ({
        title: section.title.trim(),
        items: section.items.map((item) => ({
          name: item.name.trim(),
          ...(clean(item.price) ? { price: clean(item.price) } : {}),
          ...(clean(item.tag) ? { tag: clean(item.tag) } : {})
        }))
      })),
      drinks: venue.drinks.map((section) => ({
        title: section.title.trim(),
        items: section.items.map((item) => ({
          name: item.name.trim(),
          ...(clean(item.price) ? { price: clean(item.price) } : {}),
          ...(clean(item.tag) ? { tag: clean(item.tag) } : {})
        }))
      }))
    };
  });

  const content = `export type WebsiteMenuItem = {
  name: string;
  price?: string;
  tag?: string;
};

export type WebsiteMenuSection = {
  title: string;
  items: WebsiteMenuItem[];
};

export type WebsiteMenu = {
  title: string;
  location: string;
  image?: string;
  foodHref: string;
  drinksHref: string;
  setMenus: Array<{ title: string; price: string }>;
  sections: WebsiteMenuSection[];
  drinks: WebsiteMenuSection[];
};

export const menus: WebsiteMenu[] = ${JSON.stringify(menus, null, 2)};
`;

  return {
    data,
    content
  };
}

async function github<T>(path: string, init?: RequestInit) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.websiteMenu.githubToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'alma-suite-menu-publisher',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init?.headers
    }
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.message ? `GitHub rejected the menu update: ${body.message}` : 'GitHub rejected the menu update.';
    throw new HttpError(response.status, message);
  }

  return body as T;
}

export const websiteMenuService = {
  validate(input: unknown) {
    const { data, content } = menuContentFromPayload(input);
    return {
      ok: true,
      dryRun: true,
      venueCount: data.venues.length,
      itemCount: data.venues.reduce(
        (sum, venue) =>
          sum +
          venue.sections.reduce((sectionSum, section) => sectionSum + section.items.length, 0) +
          venue.drinks.reduce((sectionSum, section) => sectionSum + section.items.length, 0),
        0
      ),
      content
    };
  },

  async publish(input: unknown, actor?: { email?: string | null; firstName?: string; lastName?: string }) {
    const { data, content } = menuContentFromPayload(input);
    if (data.dryRun) return this.validate(input);
    if (!env.websiteMenu.githubToken) {
      throw new HttpError(
        503,
        'Website menu publishing is not configured. Add WEBSITE_MENU_GITHUB_TOKEN to the API environment first.'
      );
    }

    const encodedPath = env.websiteMenu.filePath.split('/').map(encodeURIComponent).join('/');
    const repo = `/repos/${env.websiteMenu.repoOwner}/${env.websiteMenu.repoName}`;
    const current = await github<GitHubContentResponse>(
      `${repo}/contents/${encodedPath}?ref=${encodeURIComponent(env.websiteMenu.branch)}`
    );
    const message =
      clean(data.message) ||
      `Update website menus from ALMA Reports${actor?.email ? ` (${actor.email})` : ''}`;
    const committed = await github<GitHubCommitResponse>(`${repo}/contents/${encodedPath}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: Buffer.from(content, 'utf8').toString('base64'),
        sha: current.sha,
        branch: env.websiteMenu.branch,
        committer: {
          name: env.websiteMenu.committerName,
          email: env.websiteMenu.committerEmail
        }
      })
    });

    return {
      ok: true,
      dryRun: false,
      branch: env.websiteMenu.branch,
      filePath: env.websiteMenu.filePath,
      commitSha: committed.commit?.sha,
      commitUrl: committed.commit?.html_url,
      fileUrl: committed.content?.html_url,
      message
    };
  }
};
