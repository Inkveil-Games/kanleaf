import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { Providers } from './providers';

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with server configuration on a fresh device', () => {
    render(
      <Providers>
        <App />
      </Providers>,
    );

    expect(
      screen.getByRole('heading', { name: 'Connect to your server' }),
    ).toBeInTheDocument();
  });
});
