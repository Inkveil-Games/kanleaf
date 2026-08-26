import { createHashRouter, RouterProvider } from 'react-router-dom';
import { App } from './App';

const router = createHashRouter([
  {
    path: '*',
    element: <App />,
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
