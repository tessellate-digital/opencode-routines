import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import RoutinesList from './pages/RoutinesList';
import RoutineDetail from './pages/RoutineDetail';
import RoutineForm from './pages/RoutineForm';
import RunsList from './pages/RunsList';
import RunDetail from './pages/RunDetail';
import Settings from './pages/Settings';
import DevPage from './pages/DevPage';
import { HostMountsProvider } from './contexts/HostMountsContext';

export default function App() {
  return (
    <HostMountsProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/routines" element={<RoutinesList />} />
            <Route path="/routines/new" element={<RoutineForm />} />
            <Route path="/routines/:id" element={<RoutineDetail />} />
            <Route path="/routines/:id/edit" element={<RoutineForm />} />
            <Route path="/runs" element={<RunsList />} />
            <Route path="/runs/:id" element={<RunDetail />} />
            <Route path="/settings" element={<Settings />} />
            {import.meta.env.VITE_DEV === 'true' && <Route path="/dev" element={<DevPage />} />}
          </Route>
        </Routes>
      </BrowserRouter>
    </HostMountsProvider>
  );
}
