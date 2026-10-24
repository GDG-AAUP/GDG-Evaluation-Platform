import { useEffect, useRef } from 'react';
import { USE_MOCK } from '../../config.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Link, navigate } from '../../router/router.jsx';
import Icon from '../ui/Icon.jsx';
import { Dialog, DialogActions } from '../ui/Dialog.jsx';
import { Button } from '../ui/Primitives.jsx';
import { ColorBar } from './Logo.jsx';
import Header from './Header.jsx';
import { BottomTabs, Sidebar } from './Navigation.jsx';
import {BranchSwitcher} from '../../context/BranchContext.jsx';
import DemoPanel from './DemoPanel.jsx';

export default function AppShell({ path, children }) {
  const { user, expired, logout } = useAuth();
  const main = useRef(null);

  useEffect(() => { window.scrollTo(0, 0); }, [path]);

  return (
    <>
      <a href="#main" className="sr" onClick={(e) => { e.preventDefault(); main.current && main.current.focus(); }}>تخطّي إلى المحتوى</a>
      <ColorBar />
      <Header />
      <div className="layout">
        <Sidebar role={user.role} path={path} />
        <main id="main" tabIndex={-1} ref={main}>{user.role === "organizer" && (
  <div className="workspace-branch">
    <BranchSwitcher />
  </div>
)}{children}</main>
      </div>
      <BottomTabs role={user.role} path={path} />
      {path !== '/assistant' && <Link to="/assistant" className="fab" aria-label="فتح المساعد"><Icon name="chat" /></Link>}
      {USE_MOCK && <DemoPanel />}
      {expired && (
        <Dialog title="انتهت جلستك" sticky onClose={() => {}}>
          <p style={{ margin: 0 }}>انتهت صلاحية الجلسة. سجّل الدخول مرة أخرى للمتابعة.</p>
          <DialogActions>
            <Button variant="primary" onClick={async () => { await logout(); navigate('/login'); }}>تسجيل الدخول</Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
