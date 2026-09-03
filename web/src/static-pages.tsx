import { StrictMode, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import PeopleDirectoryPage from './PeopleDirectoryPage';
import PersonPage from './PersonPage';
import App from './App';
import type { LegislatorWithSlug, PersonDirectoryItem } from './people';

function renderApp(element: ReactNode) {
  return renderToString(<StrictMode>{element}</StrictMode>);
}

export function renderHomePage() {
  return renderApp(<App initialPathname="/" initialSearch="" />);
}

export function renderPersonPage(person: LegislatorWithSlug) {
  return renderApp(<PersonPage person={person} />);
}

export function renderPeopleDirectoryPage(entries: PersonDirectoryItem[]) {
  return renderApp(<PeopleDirectoryPage entries={entries} />);
}
