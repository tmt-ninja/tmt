//! The door's handler: `<prefix>/x/<extension>/` mounts, root browser assets
//! and public extension entries, and otherwise the remote binding, whose routes are
//! disjoint from the mount space.
use crate::{
    http::{Handler, Head, Reply, Request},
    mount::Mounts,
    pages::Pages,
    routes::Routes,
};
use std::{net::TcpStream, sync::Arc};

pub struct Site {
    pub routes: Routes,
    pub mounts: Arc<Mounts>,
    /// Present while serve can pair browsers; without it those paths are 404.
    pub pages: Option<Pages>,
    cloud_keys: Option<Arc<crate::cloud_keys::CloudKeys>>,
}
impl Site {
    pub fn new(routes: Routes, mounts: Arc<Mounts>, pages: Option<Pages>) -> Self {
        Self {
            routes,
            mounts,
            pages,
            cloud_keys: None,
        }
    }
    pub fn with_cloud_keys(mut self, keys: Arc<crate::cloud_keys::CloudKeys>) -> Self {
        self.cloud_keys = Some(keys);
        self
    }
}
impl Handler for Site {
    fn extra_app_route(&self, path: &str) -> bool {
        self.mounts.extra_app_extension(path).is_some()
    }
    fn admit(&self, head: &Head<'_>) -> Result<usize, Reply> {
        if self.mounts.serves(head.path) {
            self.mounts.admit(head)
        } else if Pages::serves(head.path) {
            self.pages
                .as_ref()
                .map_or(Err(Reply::empty(404)), |pages| pages.admit(head))
        } else if self.mounts.extra_app_extension(head.path).is_some() {
            self.pages
                .as_ref()
                .map_or(Err(Reply::empty(404)), |pages| pages.admit_extra(head))
        } else {
            self.routes.admit(head)
        }
    }
    fn handle(&self, request: Request, client: &mut TcpStream) -> Option<Reply> {
        if self.mounts.serves(&request.path) {
            self.mounts.handle(request, client)
        } else if Mounts::short_route(&request.path) {
            let path = request.path.clone();
            self.mounts
                .handle_short(request, client)
                .map(|reply| crate::pages::page_refusal(&path, reply.status))
        } else if Pages::serves(&request.path) {
            Some(self.pages.as_ref().map_or(Reply::empty(404), |pages| {
                pages.handle(&request, &self.mounts)
            }))
        } else if self.mounts.extra_app_extension(&request.path).is_some() {
            Some(
                self.pages
                    .as_ref()
                    .map_or(Reply::empty(404), |pages| pages.extra_page()),
            )
        } else {
            self.routes.handle(request, client)
        }
    }
    fn maintain(&self) -> Result<(), crate::error::RemoteError> {
        self.routes.maintain()?;
        if let Some(keys) = &self.cloud_keys {
            // The lifecycle owner retains the fixed failure in CloudKeys::renewal_status;
            // a cloud-only refusal never stops pairing or repeats stderr on each tick.
            let _ = keys.maintain((crate::objects::system_clock())());
        }
        Ok(())
    }
    fn shutdown(&self) {
        self.routes.shutdown();
        self.mounts.shutdown();
    }
}
