import { Navigate, Outlet } from "react-router-dom";
import { getAuth } from "../utils/auth";

export default function RequireAuth({ allowRoles }) {
  const auth = getAuth();
  const role = auth?.role;

  if (!role) return <Navigate to="/" replace />;
  if (allowRoles && !allowRoles.includes(role)) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}
