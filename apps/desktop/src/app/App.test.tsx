import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the Kanleaf identity', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Structured work, durable notes.' }),
    ).toBeInTheDocument();
  });
});
