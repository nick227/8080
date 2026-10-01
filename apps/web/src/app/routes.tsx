import React from 'react';
import { Home } from '../views/Home';
import { Room } from '../views/Room';

export function Routes() {
  const path = window.location.pathname;

  const roomMatch = path.match(/^\/room\/([^/]+)/);
  if (roomMatch) return <Room roomId={roomMatch[1]} />;

  return <Home />;
}
