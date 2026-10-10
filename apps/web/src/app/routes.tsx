import React from 'react';
import { BrowserRouter, Routes as RouterRoutes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Home } from '../views/Home';
import { Room } from '../views/Room';

function AnimatedRoutes() {
  const location = useLocation();
  
  return (
    <AnimatePresence mode="wait">
      <RouterRoutes location={location} key={location.pathname.match(/^\/room\/[^/]+/)?.[0] ?? location.pathname}>
        <Route path="/" element={
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            style={{ width: '100%', height: '100%' }}
          >
            <Home />
          </motion.div>
        } />
        {["/room/:roomId", "/room/:roomId/tasks", "/room/:roomId/tasks/:taskKey"].map((path) => <Route key={path} path={path} element={
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.2 }}
            style={{ width: '100%', height: '100%' }}
          >
            <RoomWrapper />
          </motion.div>
        } />)}
      </RouterRoutes>
    </AnimatePresence>
  );
}

import { useParams } from 'react-router-dom';

function RoomWrapper() {
  const { roomId } = useParams();
  return <Room roomId={roomId!} />;
}

export function Routes() {
  return (
    <BrowserRouter>
      <AnimatedRoutes />
    </BrowserRouter>
  );
}
