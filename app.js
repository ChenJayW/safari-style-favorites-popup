'use strict';

const POPUP_MIN_WIDTH = 360;
const POPUP_MAX_WIDTH = 800;
const MAX_FOLDER_DEPTH = 100;
const BOOKMARK_REFRESH_DELAY = 130;
const TOAST_DURATION = 2400;
const QUICK_LIST_STORAGE_KEY = 'quickListItems';
const QUICK_GROUPS_STORAGE_KEY = 'quickListGroups';
const QUICK_LIST_LIMIT = 200;
const QUICK_GROUP_LIMIT = 30;
const COLLAPSE_STORAGE_KEY = 'collapsedSections';
const SCROLL_STORAGE_KEY = 'popupScrollTop';
const FAVICON_SIZE = globalThis.devicePixelRatio>1 ? 128 : 64;
const DRAG_SCROLL_EDGE = 72;
const DRAG_SCROLL_MAX_STEP = 18;
const SCROLL_SAVE_DELAY = 140;
const systemThemeQuery = matchMedia('(prefers-color-scheme: dark)');
const embeddedMode = new URLSearchParams(location.search).get('embedded') === '1';

if (embeddedMode) document.documentElement.classList.add('embedded-view');

// Preview data and browser API adapters
// The extension reads Chrome's real bookmark tree. The fallback data is only
// shown when popup.html is opened locally for design preview.
const previewMode = !globalThis.chrome?.bookmarks;
const previewTree = [{id:'0',title:'root',children:[
  {id:'1',title:'书签栏',parentId:'0',children:[
    {id:'11',title:'Apple',parentId:'1',url:'https://www.apple.com'},
    {id:'12',title:'GitHub',parentId:'1',url:'https://github.com'},
    {id:'13',title:'YouTube',parentId:'1',url:'https://www.youtube.com'},
    {id:'14',title:'Wikipedia',parentId:'1',url:'https://zh.wikipedia.org'},
    {id:'15',title:'Figma',parentId:'1',url:'https://www.figma.com'},
    {id:'16',title:'Notion',parentId:'1',url:'https://www.notion.so'},
    {id:'17',title:'Google',parentId:'1',url:'https://www.google.com'},
    {id:'18',title:'设计灵感',parentId:'1',children:[
      {id:'181',title:'Dribbble',parentId:'18',url:'https://dribbble.com'},
      {id:'182',title:'Behance',parentId:'18',url:'https://www.behance.net'}
    ]},
    {id:'19',title:'MDN',parentId:'1',url:'https://developer.mozilla.org'},
    {id:'20',title:'Unsplash',parentId:'1',url:'https://unsplash.com'}
  ]},
  {id:'2',title:'其他书签',parentId:'0',children:[]}
]}];
let previewId = 1000;
const previewIndex = () => {
  const map = new Map();
  const visit = (node) => {
    map.set(node.id,node);
    (node.children||[]).forEach(visit);
  };
  previewTree.forEach(visit);
  return map;
};
const mockBookmarks = {
  async getTree(){
    return previewTree;
  },
  async create(info){
    const parent=previewIndex().get(info.parentId);
    const node={id:String(++previewId),title:info.title,parentId:info.parentId};
    if(info.url)node.url=info.url;
    else node.children=[];
    parent.children.push(node);
    return node;
  },
  async update(id,changes){
    Object.assign(previewIndex().get(id),changes);
  },
  async remove(id){
    const node=previewIndex().get(id);
    const parent=previewIndex().get(node.parentId);
    parent.children=parent.children.filter(child=>child.id!==id);
  },
  async removeTree(id){
    return this.remove(id);
  },
  async move(id,info){
    const index=previewIndex();
    const node=index.get(id);
    const oldParent=index.get(node.parentId);
    const parent=index.get(info.parentId);
    oldParent.children=oldParent.children.filter(child=>child.id!==id);
    node.parentId=info.parentId;
    parent.children.splice(Math.max(0,Math.min(info.index,parent.children.length)),0,node);
    return node;
  }
};
const bookmarksApi = previewMode ? mockBookmarks : chrome.bookmarks;
const storageApi = previewMode ? {
  async get(){
    try{return JSON.parse(localStorage.getItem('safariPrefs')||'{}');}
    catch{return {};}
  },
  async set(data){
    const old=await this.get();
    localStorage.setItem('safariPrefs',JSON.stringify({...old,...data}));
  }
} : chrome.storage.local;
const $ = (id) => document.getElementById(id);
const els = Object.fromEntries([
  'tilesGrid','countChip',
  'breadcrumbs','emptyState','emptySymbol','emptyTitle','emptyDescription','emptyAddButton',
  'favoritesSection','favoritesContent','favoritesToggle',
  'quickList','quickListCount','quickListEmpty','addQuickGroupButton',
  'quickListSection','quickListContent','quickListToggle',
  'addButton','folderButton','settingsButton','themeButton','manageButton','embeddedCloseButton','editorDialog',
  'editorForm','editorEyebrow','editorTitle','kindToggle','nameInput','urlInput','urlField','formError','saveButton',
  'groupDialog','groupForm','groupDialogTitle','groupNameInput','groupFormError','saveGroupButton',
  'settingsDialog','folderChoices','appearanceOptions','contextMenu','toast'
].map((id)=>[id,$(id)]));
function setFormError(element,message=''){
  element.textContent=message;
  element.classList.toggle('hidden',!message);
}

// Application state
const state = {
  tree: [],
  index: new Map(),
  rootId: null,
  folderId: null,
  theme: 'auto',
  editId: null,
  editorTarget: 'bookmarks',
  editorKind: 'bookmark',
  editGroupId: null,
  editQuickGroupId: null,
  menuId: null,
  quickGroups: [],
  collapsedSections: {favorites:false,quickList:false}
};
const renderedQuickGroupSignatures=new WeakMap();
const folderSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M2.6 7.5c0-1.4 1.1-2.5 2.5-2.5h5.2l2.1 2.4h6.4c1.5 0 2.6 1.1 2.6 2.6v8.7c0 1.4-1.1 2.5-2.5 2.5H5.1c-1.4 0-2.5-1.1-2.5-2.5V7.5Z"/></svg>';
const moreSvg = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
const palette = [
  ['#e1e9fb','#567dd5'],['#fbe7e9','#cf718b'],['#e4f4ed','#4b9a7d'],
  ['#f9ebd9','#c68b49'],['#ece6fb','#8d70cf'],['#e5f3f9','#5899b5'],
  ['#f5e7f2','#ae73af'],['#e8ecf5','#6b83a9']
];
let toastTimer;
let refreshTimer;
let scrollSaveTimer;
let scrollPersistenceReady=false;
let panelClosing=false;
let browserWindowId=null;
let reloadSequence=0;
let localMutationDepth=0;
let bookmarkRefreshPending=false;
let bookmarkMutationQueue=Promise.resolve();
let quickGroupsWriteQueue=Promise.resolve();
let quickGroupsPendingWrites=0;
let hasPendingStoredQuickGroups=false;
let persistedQuickGroups=[];
let quickGroupsReady=false;
let quickGroupsReadSequence=0;

// Popup sizing
function applyPopupWidth(browserWidth){
  if(!Number.isFinite(browserWidth))return;
  const width=Math.max(POPUP_MIN_WIDTH,Math.min(POPUP_MAX_WIDTH,Math.floor(browserWidth)));
  document.documentElement.style.setProperty('--popup-width',width+'px');
}
async function syncPopupWidth(){
  if(previewMode || embeddedMode){applyPopupWidth(window.innerWidth);return;}
  try{
    const browserWindow=await chrome.windows.getCurrent();
    browserWindowId=browserWindow?.id??null;
    applyPopupWidth(browserWindow?.width);
  }catch(err){console.warn('无法读取浏览器窗口宽度',err);}
}

async function closePanel(){
  if(panelClosing)return;
  panelClosing=true;
  await saveScrollPosition(true);
  if(embeddedMode){
    window.parent.postMessage({source:'safari-style-favorites-popup',type:'close'},'*');
    return;
  }
  window.close();
}

// Scroll persistence
function getScrollContainer(){
  const bodyStyle=getComputedStyle(document.body);
  const bodyIsScroller=/(auto|scroll)/.test(bodyStyle.overflowY)
    && document.body.scrollHeight>document.body.clientHeight;
  return bodyIsScroller?document.body:document.scrollingElement;
}
function saveScrollPosition(force=false){
  if(!scrollPersistenceReady || (panelClosing && !force))return Promise.resolve();
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer=null;
  const scrollTop=getScrollContainer()?.scrollTop||0;
  return storageApi.set({[SCROLL_STORAGE_KEY]:scrollTop})
    .catch(err=>console.warn('无法保存滚动位置',err));
}
function scheduleScrollPositionSave(){
  if(!scrollPersistenceReady)return;
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer=setTimeout(saveScrollPosition,SCROLL_SAVE_DELAY);
}
function restoreScrollPosition(value){
  const scrollTop=Number.isFinite(value)?Math.max(0,value):0;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const scroller=getScrollContainer();
    if(scroller)scroller.scrollTop=Math.min(scrollTop,Math.max(0,scroller.scrollHeight-scroller.clientHeight));
    scrollPersistenceReady=true;
  }));
}

// Bookmark tree and navigation
function enumerate(node,map){
  const stack=[node];
  while(stack.length){
    const current=stack.pop();
    if(!current||map.has(current.id))continue;
    map.set(current.id,current);
    const children=current.children||[];
    for(let index=children.length-1;index>=0;index--)stack.push(children[index]);
  }
}
function isFolderNode(node){
  return Boolean(node && !node.url);
}
function readFolder(){
  const node=state.index.get(state.folderId);
  return isFolderNode(node) ? node : state.index.get(state.rootId);
}
function initialFolder(tree){
  const root=tree[0];
  return (root?.children||[]).find(node=>node.id==='1' && isFolderNode(node))
      || (root?.children||[]).find(isFolderNode)
      || root;
}
function isFolderWithinRoot(id){
  let current=state.index.get(id);
  let depth=0;
  while(isFolderNode(current) && depth++<MAX_FOLDER_DEPTH){
    if(current.id===state.rootId)return true;
    current=state.index.get(current.parentId);
  }
  return false;
}
async function reloadTree(){
  clearTimeout(refreshTimer);
  refreshTimer=null;
  const requestId=++reloadSequence;
  const tree=await bookmarksApi.getTree();
  if(requestId!==reloadSequence)return;

  const index=new Map();
  for(const node of tree)enumerate(node,index);
  state.tree=tree;
  state.index=index;

  const defaultNode=initialFolder(state.tree);
  if(!defaultNode){renderError();return;}
  const previousRootId=state.rootId;
  const previousFolderId=state.folderId;
  if(!isFolderNode(state.index.get(state.rootId))){
    state.rootId=defaultNode.id;
  }
  if(!isFolderNode(state.index.get(state.folderId)) || !isFolderWithinRoot(state.folderId)){
    state.folderId=state.rootId;
  }
  render();
  if(state.rootId!==previousRootId || state.folderId!==previousFolderId){
    try{
      await storageApi.set({favoriteFolderId:state.rootId,lastFolderId:state.folderId});
    }catch(err){console.warn('无法保存收藏夹位置',err);}
  }
}
function scheduleBookmarkReload(){
  clearTimeout(refreshTimer);
  refreshTimer=setTimeout(()=>reloadTree().catch(showError),BOOKMARK_REFRESH_DELAY);
}
function mutateBookmarks(operation){
  const mutation=bookmarkMutationQueue.then(async()=>{
    localMutationDepth++;
    try{
      const result=await operation();
      // Events emitted by the completed local operation are covered by this
      // full refresh. Any event arriving during the refresh sets the flag again.
      bookmarkRefreshPending=false;
      await reloadTree();
      return result;
    }finally{
      localMutationDepth--;
      if(localMutationDepth===0&&bookmarkRefreshPending){
        bookmarkRefreshPending=false;
        scheduleBookmarkReload();
      }
    }
  });
  bookmarkMutationQueue=mutation.catch(()=>{});
  return mutation;
}

// Appearance
function renderError(){
  els.tilesGrid.replaceChildren();
  els.emptyState.classList.remove('hidden');
  els.emptyTitle.textContent='无法读取书签';
  els.emptyDescription.textContent='请检查 Chrome 是否允许此扩展访问书签。';
}
function applyTheme(){
  const dark=state.theme==='dark'||(state.theme==='auto' && systemThemeQuery.matches);
  document.documentElement.dataset.theme=dark?'dark':'light';
  els.themeButton.title=dark?'切换到浅色外观':'切换到深色外观';
  els.themeButton.setAttribute('aria-label',els.themeButton.title);
  for(const btn of els.appearanceOptions.querySelectorAll('button'))
    btn.classList.toggle('selected',btn.dataset.theme===state.theme);
}
async function setTheme(theme){
  const previousTheme=state.theme;
  state.theme=theme;
  applyTheme();
  try{
    await storageApi.set({theme});
  }catch(err){
    state.theme=previousTheme;
    applyTheme();
    throw err;
  }
}
function normalizeCollapsedSections(value){
  return {
    favorites:Boolean(value?.favorites),
    quickList:Boolean(value?.quickList)
  };
}
function applyCollapsedSection(sectionName){
  const isFavorites=sectionName==='favorites';
  const section=isFavorites?els.favoritesSection:els.quickListSection;
  const content=isFavorites?els.favoritesContent:els.quickListContent;
  const toggle=isFavorites?els.favoritesToggle:els.quickListToggle;
  const label=isFavorites?'收藏夹':'快捷列表';
  const collapsed=state.collapsedSections[sectionName];

  content.hidden=collapsed;
  section.classList.toggle('is-collapsed',collapsed);
  toggle.setAttribute('aria-expanded',String(!collapsed));
  toggle.title=collapsed?`展开${label}`:`折叠${label}`;
  toggle.setAttribute('aria-label',toggle.title);
}
async function toggleSection(sectionName){
  const previousSections=state.collapsedSections;
  state.collapsedSections={
    ...previousSections,
    [sectionName]:!state.collapsedSections[sectionName]
  };
  applyCollapsedSection(sectionName);
  try{
    await storageApi.set({[COLLAPSE_STORAGE_KEY]:state.collapsedSections});
  }catch(err){
    state.collapsedSections=previousSections;
    applyCollapsedSection(sectionName);
    throw err;
  }
}

// Bookmark rendering and navigation
function folderLineage(id){
  const path=[];
  let current=state.index.get(id);
  let depth=0;
  while(current && depth++<MAX_FOLDER_DEPTH){
    path.push(current);
    if(current.id===state.rootId) break;
    current=state.index.get(current.parentId);
  }
  if(path[path.length-1]?.id!==state.rootId) return [state.index.get(state.rootId)].filter(Boolean);
  return path.reverse();
}
function renderBreadcrumbs(){
  const fragment=document.createDocumentFragment();
  const lineage=folderLineage(state.folderId);
  lineage.forEach((n,i)=>{
    if(i>0){
      const separator=document.createElement('span');
      separator.className='crumb-separator';
      separator.textContent='›';
      fragment.append(separator);
    }
    const button=document.createElement('button');
    button.type='button';
    button.textContent=n.title||'书签';
    if(i===lineage.length-1){
      button.className='crumb-current';
      button.setAttribute('aria-current','page');
    }
    button.addEventListener('click',()=>openFolder(n.id).catch(showError));
    fragment.append(button);
  });
  els.breadcrumbs.replaceChildren(fragment);
}
function websiteMonogram(bookmark){
  try{
    const host=new URL(bookmark.url).hostname.replace(/^www\./,'');
    return (host||bookmark.title||'?').slice(0,1).toLocaleUpperCase();
  }catch{return (bookmark.title||'?').slice(0,1).toLocaleUpperCase();}
}
function tileColor(node){
  let value=0;const name=node.url||node.title;
  for(let i=0;i<name.length;i++) value=(value*31+name.charCodeAt(i))|0;
  return palette[Math.abs(value)%palette.length];
}
function safeBookmarkHref(url){
  try{
    const u=new URL(url);
    if(['http:','https:','chrome:','file:'].includes(u.protocol))return u.href;
  }catch{}
  return null;
}
function makeWebsiteIcon(node){
  const icon=document.createElement('span');
  icon.className='website-icon';
  const [background,color]=tileColor(node);
  icon.style.setProperty('--tile-background',background);
  icon.style.setProperty('--tile-color',color);
  icon.textContent=websiteMonogram(node);

  if(!previewMode && /^https?:\/\//i.test(node.url)){
    const image=document.createElement('img');
    image.loading='lazy';
    image.decoding='async';
    image.alt='';
    image.src=chrome.runtime.getURL('_favicon/')+'?pageUrl='+encodeURIComponent(node.url)+'&size='+FAVICON_SIZE;
    image.addEventListener('error',()=>image.remove());
    icon.append(image);
  }
  return icon;
}
// Chrome extension popups must never navigate their own tiny window.
// Default: reuse the selected tab, like Safari bookmarks. Command/Ctrl/middle: new tab.
async function openWebsite(url, newTab=false){
  const href=safeBookmarkHref(url);
  if(!href){showToast('此网址不能从收藏夹打开');return;}
  if(previewMode){
    window.open(href,'_blank','noopener,noreferrer');
    return;
  }
  try{
    if(newTab){
      await chrome.tabs.create({url:href,active:true});
    }else{
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(tab?.id!=null)await chrome.tabs.update(tab.id,{url:href});
      else await chrome.tabs.create({url:href,active:true});
    }
    await closePanel();
  }catch(err){showError(err);}
}
function configureWebsiteLink(link,url){
  const href=safeBookmarkHref(url);
  if(!href){
    link.href='#';
    link.addEventListener('click',event=>{
      event.preventDefault();
      showToast('该链接无法从扩展中打开');
    });
    return;
  }

  link.href=href;
  link.addEventListener('click',event=>{
    event.preventDefault();
    openWebsite(href,event.metaKey||event.ctrlKey||event.shiftKey).catch(showError);
  });
  link.addEventListener('auxclick',event=>{
    if(event.button===1){
      event.preventDefault();
      openWebsite(href,true).catch(showError);
    }
  });
}
// Drag state shared by bookmark sorting, quick-item moving, and group sorting.
let dragState=null;
let dragScrollFrame=0;
let dragPointerY=null;
let dragSourceElement=null;
let activeDropIndicator=null;
let activeDropClass=null;
let activeQuickDropzone=null;
function stopDragAutoScroll(){
  dragPointerY=null;
  if(dragScrollFrame){
    cancelAnimationFrame(dragScrollFrame);
    dragScrollFrame=0;
  }
}
function scheduleDragAutoScroll(event){
  if(!dragState)return;
  dragPointerY=event.clientY;
  if(dragScrollFrame)return;
  dragScrollFrame=requestAnimationFrame(()=>{
    dragScrollFrame=0;
    if(!dragState||dragPointerY==null)return;

    const viewportHeight=window.innerHeight;
    const edge=Math.min(DRAG_SCROLL_EDGE,viewportHeight*.2);
    let direction=0;
    let strength=0;
    if(dragPointerY<edge){
      direction=-1;
      strength=(edge-dragPointerY)/edge;
    }else if(dragPointerY>viewportHeight-edge){
      direction=1;
      strength=(dragPointerY-(viewportHeight-edge))/edge;
    }
    if(!direction)return;

    const scroller=getScrollContainer();
    if(!scroller)return;
    const step=Math.ceil(DRAG_SCROLL_MAX_STEP*Math.min(1,strength));
    scroller.scrollTop+=direction*step;
  });
}
function handleDocumentDragOver(event){
  scheduleDragAutoScroll(event);
  if(!event.defaultPrevented){
    clearDropPositionIndicators();
    setActiveQuickDropzone(null);
  }
}
function clearDropPositionIndicators(){
  if(activeDropIndicator&&activeDropClass)activeDropIndicator.classList.remove(activeDropClass);
  activeDropIndicator=null;
  activeDropClass=null;
}
function setDropPositionIndicator(element,className){
  if(activeDropIndicator===element&&activeDropClass===className)return;
  clearDropPositionIndicators();
  activeDropIndicator=element;
  activeDropClass=className;
  element.classList.add(className);
}
function setActiveQuickDropzone(dropzone){
  if(activeQuickDropzone===dropzone)return;
  activeQuickDropzone?.classList.remove('drag-over');
  activeQuickDropzone=dropzone;
  activeQuickDropzone?.classList.add('drag-over');
}
function setDragSourceElement(element){
  dragSourceElement?.classList.remove('dragging');
  dragSourceElement=element;
  dragSourceElement.classList.add('dragging');
}
function startDrag(event,nextDragState,sourceElement,transferText,effectAllowed='move'){
  dragState=nextDragState;
  event.dataTransfer.effectAllowed=effectAllowed;
  event.dataTransfer.setData('text/plain',transferText);
  setDragSourceElement(sourceElement);
}
function clearDragIndicators(){
  dragState=null;
  stopDragAutoScroll();
  clearDropPositionIndicators();
  setActiveQuickDropzone(null);
  dragSourceElement?.classList.remove('dragging');
  dragSourceElement=null;
  reconcilePendingQuickGroups();
}
function enableTileSorting(tile,wrap,node){
  tile.draggable=true;
  tile.setAttribute('aria-description','可拖动调整收藏顺序');
  tile.addEventListener('dragstart',e=>{
    startDrag(e,{kind:'bookmark',id:node.id},wrap,node.id,'copyMove');
  });
  tile.addEventListener('dragend',clearDragIndicators);
  wrap.addEventListener('dragover',e=>{
    if(dragState?.kind!=='bookmark' || dragState.id===node.id)return;
    const siblings=readFolder()?.children||[];
    if(!siblings.some(n=>n.id===dragState.id))return;
    e.preventDefault();
    e.dataTransfer.dropEffect='move';
    setActiveQuickDropzone(null);
    const rect=wrap.getBoundingClientRect();
    setDropPositionIndicator(wrap,e.clientX<rect.left+rect.width/2?'drop-before':'drop-after');
  });
  wrap.addEventListener('drop',async e=>{
    if(dragState?.kind!=='bookmark' || dragState.id===node.id)return;
    e.preventDefault();
    const movingId=dragState.id;
    const after=wrap.classList.contains('drop-after');
    clearDragIndicators();
    const folder=readFolder();
    const siblings=folder?.children||[];
    const from=siblings.findIndex(n=>n.id===movingId);
    const to=siblings.findIndex(n=>n.id===node.id);
    if(from<0||to<0||!folder)return;
    const slot=to+(after?1:0);
    const index=slot-(from<slot?1:0);
    if(index===from)return;
    try{
      await mutateBookmarks(()=>bookmarksApi.move(movingId,{parentId:folder.id,index}));
      showToast('已调整收藏顺序');
    }catch(err){showError(err);}
  });
}
function makeTile(node){
  const wrap=document.createElement('div');
  wrap.className='tile-wrap';

  const isFolder=isFolderNode(node);
  const tile=document.createElement(isFolder?'button':'a');
  tile.className='tile';
  tile.title=node.title||node.url||'文件夹';

  if(isFolder){
    tile.type='button';
    tile.addEventListener('click',()=>openFolder(node.id).catch(showError));
  }else{
    configureWebsiteLink(tile,node.url);
  }

  const plate=document.createElement('span');
  plate.className='tile-plate';
  if(isFolder){
    const icon=document.createElement('span');
    icon.className='folder-icon';
    icon.innerHTML=folderSvg;
    plate.append(icon);
  }else{
    plate.append(makeWebsiteIcon(node));
  }

  const label=document.createElement('span');
  label.className='tile-label';
  label.textContent=node.title||node.url||'未命名';
  tile.append(plate,label);
  wrap.append(tile);
  enableTileSorting(tile,wrap,node);

  const more=document.createElement('button');
  more.type='button';
  more.className='tile-more';
  more.title='更多操作';
  more.setAttribute('aria-label',`更多操作：${label.textContent}`);
  more.innerHTML=moreSvg;
  more.addEventListener('click',e=>{
    e.stopPropagation();
    showContextMenu(node,more);
  });
  wrap.append(more);
  return wrap;
}
function createQuickId(prefix){
  return globalThis.crypto?.randomUUID?.()||`${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function normalizeQuickItems(value,limit=QUICK_LIST_LIMIT){
  if(!Array.isArray(value)||limit<=0)return [];
  const items=[];
  const ids=new Set();
  for(const candidate of value){
    const url=safeBookmarkHref(candidate?.url);
    if(!url)continue;
    let id=typeof candidate.id==='string'&&candidate.id?candidate.id:createQuickId('quick-item');
    if(ids.has(id))id=createQuickId('quick-item');
    ids.add(id);
    items.push({
      id,
      sourceBookmarkId:typeof candidate.sourceBookmarkId==='string'?candidate.sourceBookmarkId:null,
      title:String(candidate.title||url).slice(0,120),
      url
    });
    if(items.length>=limit)break;
  }
  return items;
}
function normalizeQuickGroups(value,legacyItems=[]){
  const groups=[];
  const ids=new Set();
  let remainingItems=QUICK_LIST_LIMIT;
  if(Array.isArray(value)){
    for(const candidate of value){
      if(!candidate||typeof candidate!=='object')continue;
      let id=typeof candidate.id==='string'&&candidate.id?candidate.id:createQuickId('quick-group');
      if(ids.has(id))id=createQuickId('quick-group');
      ids.add(id);
      const items=normalizeQuickItems(candidate.items,remainingItems);
      remainingItems-=items.length;
      groups.push({
        id,
        name:String(candidate.name||'未命名分组').trim().slice(0,40)||'未命名分组',
        items
      });
      if(groups.length>=QUICK_GROUP_LIMIT)break;
    }
  }
  if(groups.length===0&&legacyItems.length>0){
    groups.push({id:createQuickId('quick-group'),name:'默认分组',items:legacyItems});
  }
  return groups;
}
function quickItemCount(groups=state.quickGroups){
  return groups.reduce((total,group)=>total+group.items.length,0);
}
function serializeQuickData(value){
  return JSON.stringify(value);
}
function applyStoredQuickGroups(value){
  if(dragState||quickGroupsPendingWrites>0){
    hasPendingStoredQuickGroups=true;
    return;
  }
  const normalized=normalizeQuickGroups(value);
  persistedQuickGroups=normalized;
  if(serializeQuickData(state.quickGroups)===serializeQuickData(normalized))return;
  state.quickGroups=normalized;
  renderQuickList();
}
function reconcilePendingQuickGroups(){
  if(quickGroupsPendingWrites>0||!hasPendingStoredQuickGroups)return;
  hasPendingStoredQuickGroups=false;
  const requestId=++quickGroupsReadSequence;
  storageApi.get([QUICK_GROUPS_STORAGE_KEY])
    .then(values=>{
      if(requestId===quickGroupsReadSequence)applyStoredQuickGroups(values[QUICK_GROUPS_STORAGE_KEY]);
    })
    .catch(err=>console.warn('无法同步快捷分组',err));
}
function saveQuickGroups(groups){
  const normalized=normalizeQuickGroups(groups);
  const normalizedSignature=serializeQuickData(normalized);
  state.quickGroups=normalized;
  renderQuickList();

  quickGroupsPendingWrites++;
  const write=quickGroupsWriteQueue.then(async()=>{
    await storageApi.set({[QUICK_GROUPS_STORAGE_KEY]:normalized,[QUICK_LIST_STORAGE_KEY]:[]});
    persistedQuickGroups=normalized;
  });
  quickGroupsWriteQueue=write.catch(()=>{});
  return write.catch(err=>{
    if(serializeQuickData(state.quickGroups)===normalizedSignature){
      state.quickGroups=persistedQuickGroups;
      renderQuickList();
    }
    throw err;
  }).finally(()=>{
    quickGroupsPendingWrites--;
    reconcilePendingQuickGroups();
  });
}
async function addQuickItemFromBookmark(node,groupId){
  if(!node?.url){
    showToast('快捷列表只支持网站书签');
    return;
  }
  const group=state.quickGroups.find(entry=>entry.id===groupId);
  if(!group){
    showToast('目标分组已不存在');
    return;
  }
  if(group.items.some(item=>item.sourceBookmarkId===node.id)){
    showToast('这个网站已经在该分组中');
    return;
  }
  if(quickItemCount()>=QUICK_LIST_LIMIT){
    showToast(`快捷列表最多保存 ${QUICK_LIST_LIMIT} 项`);
    return;
  }
  const item={
    id:createQuickId('quick-item'),
    sourceBookmarkId:node.id,
    title:node.title||node.url,
    url:node.url
  };
  const groups=state.quickGroups.map(entry=>entry.id===groupId?{...entry,items:[...entry.items,item]}:entry);
  await saveQuickGroups(groups);
  showToast(`已加入「${group.name}」`);
}
async function moveQuickItem(itemId,sourceGroupId,targetGroupId,targetItemId=null,after=false){
  const sourceGroup=state.quickGroups.find(group=>group.id===sourceGroupId);
  const targetGroup=state.quickGroups.find(group=>group.id===targetGroupId);
  const item=sourceGroup?.items.find(entry=>entry.id===itemId);
  if(!sourceGroup||!targetGroup||!item){
    showToast('快捷项目或目标分组已不存在');
    return;
  }
  if(sourceGroupId!==targetGroupId && item.sourceBookmarkId
    && targetGroup.items.some(entry=>entry.sourceBookmarkId===item.sourceBookmarkId)){
    showToast('目标分组已经有这个网站');
    return;
  }

  const groups=state.quickGroups.map(group=>({...group,items:[...group.items]}));
  const source=groups.find(group=>group.id===sourceGroupId);
  const target=groups.find(group=>group.id===targetGroupId);
  const sourceIndex=source.items.findIndex(entry=>entry.id===itemId);
  const [moving]=source.items.splice(sourceIndex,1);
  let targetIndex=target.items.length;
  if(targetItemId){
    const anchorIndex=target.items.findIndex(entry=>entry.id===targetItemId);
    if(anchorIndex>=0)targetIndex=anchorIndex+(after?1:0);
  }
  target.items.splice(targetIndex,0,moving);

  const changed=groups.some((group,index)=>{
    const previous=state.quickGroups[index];
    return group.id!==previous?.id
      || group.items.length!==previous.items.length
      || group.items.some((entry,itemIndex)=>entry.id!==previous.items[itemIndex]?.id);
  });
  if(!changed)return;
  await saveQuickGroups(groups);
  showToast(sourceGroupId===targetGroupId?'已调整快捷项目顺序':`已移动到「${targetGroup.name}」`);
}
async function moveQuickGroup(groupId,targetGroupId,after=false){
  const groups=[...state.quickGroups];
  const from=groups.findIndex(group=>group.id===groupId);
  const to=groups.findIndex(group=>group.id===targetGroupId);
  if(from<0||to<0||from===to)return;
  const slot=to+(after?1:0);
  const index=slot-(from<slot?1:0);
  if(index===from)return;
  const [moving]=groups.splice(from,1);
  groups.splice(index,0,moving);
  await saveQuickGroups(groups);
  showToast('已调整分组顺序');
}
function enableQuickItemDragging(link,wrap,item,groupId){
  link.draggable=true;
  link.setAttribute('aria-description','可拖动调整顺序或移动到其他快捷分组');
  link.addEventListener('dragstart',event=>{
    startDrag(event,{kind:'quick-item',id:item.id,groupId},wrap,`quick-item:${groupId}:${item.id}`);
  });
  link.addEventListener('dragend',clearDragIndicators);
  wrap.addEventListener('dragover',event=>{
    if(dragState?.kind!=='quick-item'
      || (dragState.id===item.id&&dragState.groupId===groupId))return;
    event.preventDefault();
    event.dataTransfer.dropEffect='move';
    setActiveQuickDropzone(null);
    const rect=wrap.getBoundingClientRect();
    setDropPositionIndicator(wrap,event.clientX<rect.left+rect.width/2?'drop-before':'drop-after');
  });
  wrap.addEventListener('drop',event=>{
    if(dragState?.kind!=='quick-item'
      || (dragState.id===item.id&&dragState.groupId===groupId))return;
    event.preventDefault();
    event.stopPropagation();
    const {id,groupId:sourceGroupId}=dragState;
    const after=wrap.classList.contains('drop-after');
    clearDragIndicators();
    moveQuickItem(id,sourceGroupId,groupId,item.id,after).catch(showError);
  });
}
function makeQuickItem(item,groupId){
  const wrap=document.createElement('div');
  wrap.className='tile-wrap quick-tile-wrap';
  const link=document.createElement('a');
  link.className='tile';
  link.title=item.title||item.url;
  configureWebsiteLink(link,item.url);
  const plate=document.createElement('span');
  plate.className='tile-plate';
  plate.append(makeWebsiteIcon(item));
  const label=document.createElement('span');
  label.className='tile-label';
  label.textContent=item.title||item.url;
  link.append(plate,label);
  wrap.append(link);
  enableQuickItemDragging(link,wrap,item,groupId);

  const more=document.createElement('button');
  more.type='button';
  more.className='tile-more';
  more.title='更多操作';
  more.setAttribute('aria-label',`更多操作：${label.textContent}`);
  more.innerHTML=moreSvg;
  more.addEventListener('click',event=>{
    event.stopPropagation();
    showQuickItemContextMenu(item,groupId,more);
  });
  wrap.append(more);
  return wrap;
}
function bindQuickGroupDropzone(dropzone,groupId){
  dropzone.addEventListener('dragover',event=>{
    if(!['bookmark','quick-item'].includes(dragState?.kind))return;
    if(event.target.closest('.quick-tile-wrap')&&dragState.kind==='quick-item')return;
    event.preventDefault();
    event.dataTransfer.dropEffect=dragState.kind==='bookmark'?'copy':'move';
    clearDropPositionIndicators();
    setActiveQuickDropzone(dropzone);
  });
  dropzone.addEventListener('dragleave',event=>{
    if(!event.currentTarget.contains(event.relatedTarget)&&activeQuickDropzone===dropzone){
      setActiveQuickDropzone(null);
    }
  });
  dropzone.addEventListener('drop',event=>{
    if(event.target.closest('.quick-tile-wrap')&&dragState?.kind==='quick-item')return;
    if(!['bookmark','quick-item'].includes(dragState?.kind))return;
    event.preventDefault();
    event.stopPropagation();
    const activeDrag=dragState;
    clearDragIndicators();
    if(activeDrag.kind==='bookmark'){
      addQuickItemFromBookmark(state.index.get(activeDrag.id),groupId).catch(showError);
    }else{
      moveQuickItem(activeDrag.id,activeDrag.groupId,groupId).catch(showError);
    }
  });
}
function enableQuickGroupDragging(section,handle,group){
  handle.draggable=true;
  handle.setAttribute('aria-description','可上下拖动调整快捷分组顺序');
  handle.addEventListener('dragstart',event=>{
    startDrag(event,{kind:'quick-group',id:group.id},section,`quick-group:${group.id}`);
  });
  handle.addEventListener('dragend',clearDragIndicators);
  section.addEventListener('dragover',event=>{
    if(dragState?.kind!=='quick-group'||dragState.id===group.id)return;
    event.preventDefault();
    event.dataTransfer.dropEffect='move';
    setActiveQuickDropzone(null);
    const rect=section.getBoundingClientRect();
    setDropPositionIndicator(section,event.clientY<rect.top+rect.height/2?'group-drop-before':'group-drop-after');
  });
  section.addEventListener('drop',event=>{
    if(dragState?.kind!=='quick-group'||dragState.id===group.id)return;
    event.preventDefault();
    event.stopPropagation();
    const movingGroupId=dragState.id;
    const after=section.classList.contains('group-drop-after');
    clearDragIndicators();
    moveQuickGroup(movingGroupId,group.id,after).catch(showError);
  });
}
function makeQuickGroup(group){
  const section=document.createElement('section');
  section.className='quick-group';
  section.dataset.quickGroupId=group.id;
  renderedQuickGroupSignatures.set(section,serializeQuickData(group));

  const heading=document.createElement('div');
  heading.className='quick-group-heading';
  const title=document.createElement('div');
  title.className='quick-group-title';
  const name=document.createElement('span');
  name.className='quick-group-name';
  name.textContent=group.name;
  const count=document.createElement('span');
  count.className='count-chip';
  count.textContent=String(group.items.length);
  title.append(name,count);

  const more=document.createElement('button');
  more.type='button';
  more.className='quick-group-more';
  more.title='分组操作';
  more.setAttribute('aria-label',`分组操作：${group.name}`);
  more.draggable=false;
  more.innerHTML=moreSvg;
  more.addEventListener('click',event=>{
    event.stopPropagation();
    showQuickGroupContextMenu(group,more);
  });
  heading.append(title,more);
  section.append(heading);
  enableQuickGroupDragging(section,title,group);

  const dropzone=document.createElement('div');
  dropzone.className='quick-group-dropzone';
  dropzone.setAttribute('aria-label',`拖放到分组：${group.name}`);
  const grid=document.createElement('div');
  grid.className='quick-group-grid';
  for(const item of group.items)grid.append(makeQuickItem(item,group.id));
  dropzone.append(grid);
  if(group.items.length===0){
    const empty=document.createElement('div');
    empty.className='quick-group-empty';
    empty.textContent='将上方的网站图标拖到这个分组';
    dropzone.append(empty);
  }
  bindQuickGroupDropzone(dropzone,group.id);
  section.append(dropzone);
  return section;
}
function renderQuickList(){
  const existingGroups=new Map(
    [...els.quickList.children].map(section=>[section.dataset.quickGroupId,section])
  );
  const fragment=document.createDocumentFragment();
  for(const group of state.quickGroups){
    const signature=serializeQuickData(group);
    const existing=existingGroups.get(group.id);
    fragment.append(renderedQuickGroupSignatures.get(existing)===signature?existing:makeQuickGroup(group));
  }
  els.quickList.replaceChildren(fragment);
  els.quickListCount.textContent=String(quickItemCount());
  els.quickListEmpty.classList.toggle('hidden',state.quickGroups.length>0);
}
function render(){
  hideContextMenu();
  const folder=readFolder();
  const nodes=folder?.children||[];
  els.countChip.textContent=String(nodes.length);
  renderBreadcrumbs();

  const fragment=document.createDocumentFragment();
  for(const node of nodes)fragment.append(makeTile(node));
  els.tilesGrid.replaceChildren(fragment);

  els.emptyState.classList.toggle('hidden',nodes.length!==0);
  if(nodes.length===0){
    els.emptySymbol.textContent='✧';
    els.emptyTitle.textContent='这里还没有收藏';
    els.emptyDescription.textContent='添加一个喜欢的网站，开启你的收藏空间。';
  }
}
async function openFolder(id){
  if(!isFolderNode(state.index.get(id)))return;
  state.folderId=id;
  render();
  await storageApi.set({lastFolderId:id});
}
async function setHomeFolder(id){
  if(!isFolderNode(state.index.get(id)))return;
  state.rootId=id;
  state.folderId=id;
  await storageApi.set({favoriteFolderId:id,lastFolderId:id});
  render();
  renderFolderChoices();
  els.settingsDialog.close();
  showToast('已切换收藏夹文件夹');
}
function collectFolders(){
  const result=[];
  const visited=new Set();
  const stack=[];
  for(let index=state.tree.length-1;index>=0;index--)stack.push({node:state.tree[index],depth:0});
  while(stack.length){
    const {node,depth}=stack.pop();
    if(!isFolderNode(node)||visited.has(node.id))continue;
    visited.add(node.id);
    if(node.id!==state.tree[0]?.id)result.push({node,depth:Math.max(0,depth-1)});
    const children=node.children||[];
    for(let index=children.length-1;index>=0;index--){
      if(isFolderNode(children[index]))stack.push({node:children[index],depth:depth+1});
    }
  }
  return result;
}
function renderFolderChoices(){
  const fragment=document.createDocumentFragment();
  const folders=collectFolders();
  for(const {node,depth} of folders){
    const button=document.createElement('button');
    button.type='button';
    button.className='folder-choice';
    button.classList.toggle('selected',node.id===state.rootId);
    button.style.paddingLeft=(12+Math.min(depth,8)*17)+'px';
    button.innerHTML=folderSvg;

    const text=document.createElement('span');
    text.className='folder-name';
    text.textContent=node.title||'未命名文件夹';
    button.append(text);

    if(node.id===state.rootId){
      const checkmark=document.createElement('span');
      checkmark.className='checkmark';
      checkmark.textContent='✓';
      button.append(checkmark);
    }
    button.addEventListener('click',()=>setHomeFolder(node.id).catch(showError));
    fragment.append(button);
  }
  els.folderChoices.replaceChildren(fragment);
}

// Quick-list group editor
function openGroupEditor(group=null){
  hideContextMenu();
  state.editGroupId=group?.id||null;
  els.groupForm.reset();
  els.groupDialogTitle.textContent=group?'重命名分组':'新增分组';
  els.saveGroupButton.textContent=group?'保存修改':'创建';
  els.groupNameInput.value=group?.name||'';
  setFormError(els.groupFormError);
  els.groupDialog.showModal();
  els.groupNameInput.focus();
}
async function saveGroupEditor(event){
  event.preventDefault();
  const name=els.groupNameInput.value.trim();
  setFormError(els.groupFormError);
  if(!name){setFormError(els.groupFormError,'请填写分组名称。');return;}
  const duplicate=state.quickGroups.some(group=>group.id!==state.editGroupId&&group.name.toLocaleLowerCase()===name.toLocaleLowerCase());
  if(duplicate){setFormError(els.groupFormError,'已经有同名分组，请换一个名称。');return;}
  if(!state.editGroupId&&state.quickGroups.length>=QUICK_GROUP_LIMIT){
    setFormError(els.groupFormError,`最多创建 ${QUICK_GROUP_LIMIT} 个分组。`);
    return;
  }

  els.saveGroupButton.disabled=true;
  try{
    const editing=Boolean(state.editGroupId);
    const groups=editing
      ? state.quickGroups.map(group=>group.id===state.editGroupId?{...group,name}:group)
      : [...state.quickGroups,{id:createQuickId('quick-group'),name,items:[]}];
    if(editing&&!groups.some(group=>group.id===state.editGroupId))throw new Error('这个快捷分组已不存在。');
    await saveQuickGroups(groups);
    els.groupDialog.close();
    showToast(editing?'已重命名分组':'已创建分组');
  }catch(err){setFormError(els.groupFormError,err.message||'操作失败，请重试。');}
  finally{els.saveGroupButton.disabled=false;}
}

// Bookmark and quick-item editor
function setEditorKind(kind){
  state.editorKind=kind;
  els.kindToggle.querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b.dataset.kind===kind));
  els.urlField.classList.toggle('hidden',kind==='folder');
  els.urlInput.required=kind==='bookmark';
  setFormError(els.formError);
}
function openEditor(node=null,target='bookmarks',groupId=null){
  hideContextMenu();
  state.editorTarget=target;
  state.editId=node?.id||null;
  state.editQuickGroupId=groupId;
  const editing=!!node;
  const editingQuickItem=target==='quick-list';
  els.editorForm.reset();
  els.editorEyebrow.textContent=editingQuickItem?'QUICK LIST':'YOUR FAVORITES';
  els.editorTitle.textContent=editingQuickItem?'编辑快捷项目':editing?'编辑收藏':'添加收藏';
  els.saveButton.textContent=editing?'保存修改':'添加';
  els.kindToggle.classList.toggle('hidden',editing);
  setEditorKind(editing && isFolderNode(node)?'folder':'bookmark');
  els.nameInput.value=editing?(node.title||''):'';
  els.urlInput.value=editing?(node.url||''):'';
  els.editorDialog.showModal();
  els.nameInput.focus();
}
function normalizeUrl(raw,allowBrowserProtocols=false){
  const val=raw.trim();
  if(!val || /\s/.test(val))throw new Error('请输入正确的网站地址。');
  const candidate=/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(val)?val:'https://'+val;
  let url;
  try{url=new URL(candidate);}catch{throw new Error('网址格式不正确，请检查后重试。');}
  const protocols=allowBrowserProtocols?['http:','https:','chrome:','file:']:['http:','https:'];
  const requiresHostname=['http:','https:'].includes(url.protocol);
  if(!protocols.includes(url.protocol)||(requiresHostname&&!url.hostname)){
    throw new Error(allowBrowserProtocols?'该网址类型不受支持。':'仅支持 http:// 或 https:// 网站地址。');
  }
  return url.href;
}
async function saveEditor(e){
  e.preventDefault();
  const title=els.nameInput.value.trim();
  setFormError(els.formError);
  if(!title){setFormError(els.formError,'请填写收藏名称。');return;}
  const item={title};
  if(state.editorKind==='bookmark'){
    try{
      item.url=normalizeUrl(els.urlInput.value,state.editorTarget==='quick-list');
    }catch(err){
      setFormError(els.formError,err.message);
      return;
    }
  }
  els.saveButton.disabled=true;
  try{
    if(state.editorTarget==='quick-list'){
      const group=state.quickGroups.find(entry=>entry.id===state.editQuickGroupId);
      if(!group)throw new Error('这个快捷分组已不存在。');
      const itemIndex=group.items.findIndex(entry=>entry.id===state.editId);
      if(itemIndex<0)throw new Error('这个快捷项目已不存在。');
      const groups=state.quickGroups.map(entry=>entry.id===group.id?{
        ...entry,
        items:entry.items.map((existing,index)=>index===itemIndex?{...existing,...item}:existing)
      }:entry);
      await saveQuickGroups(groups);
      els.editorDialog.close();
      showToast('已保存快捷项目');
      return;
    }
    const editing=Boolean(state.editId);
    await mutateBookmarks(()=>editing
      ? bookmarksApi.update(state.editId,item)
      : bookmarksApi.create({parentId:state.folderId,...item}));
    els.editorDialog.close();
    showToast(editing?'已保存修改':'添加成功');
  }catch(err){setFormError(els.formError,err.message||'操作失败，请重试。');}
  finally{els.saveButton.disabled=false;}
}

// Feedback and context menu
function showError(err){
  console.error(err);
  showToast(err?.message||'操作失败，请重试');
}
function hideContextMenu(){
  els.contextMenu.classList.add('hidden');
  els.contextMenu.replaceChildren();
  state.menuId=null;
}
function showActionMenu(menuId,anchor,options){
  if(state.menuId===menuId){
    hideContextMenu();
    return;
  }
  hideContextMenu();
  state.menuId=menuId;

  for(const {title,action,danger=false} of options){
    const button=document.createElement('button');
    button.type='button';
    button.setAttribute('role','menuitem');
    button.textContent=title;
    if(danger)button.className='danger';
    button.addEventListener('click',()=>{
      hideContextMenu();
      action();
    });
    els.contextMenu.append(button);
  }
  els.contextMenu.classList.remove('hidden');
  const rect=anchor.getBoundingClientRect();
  const w=150,h=92;
  els.contextMenu.style.top=Math.min(rect.bottom+7,window.innerHeight-h-12)+'px';
  els.contextMenu.style.left=Math.max(12,Math.min(rect.left,window.innerWidth-w-12))+'px';
}
function showContextMenu(node,anchor){
  showActionMenu(`bookmark:${node.id}`,anchor,[
    {title:'编辑名称 / 地址',action:()=>openEditor(node)},
    {title:'删除收藏',danger:true,action:async()=>{
      if(!confirm(node.url?`确定删除「${node.title}」吗？`:`确定删除文件夹「${node.title}」及其中的所有书签吗？`))return;
      try{
        await mutateBookmarks(()=>node.url?bookmarksApi.remove(node.id):bookmarksApi.removeTree(node.id));
        showToast('已删除收藏');
      }catch(err){showError(err);}
    }}
  ]);
}
function showQuickItemContextMenu(item,groupId,anchor){
  showActionMenu(`quick:${groupId}:${item.id}`,anchor,[
    {title:'编辑快捷项目',action:()=>openEditor(item,'quick-list',groupId)},
    {title:'从分组删除',danger:true,action:async()=>{
      if(!confirm(`确定从这个分组删除「${item.title}」吗？原收藏不会受影响。`))return;
      try{
        const groups=state.quickGroups.map(group=>group.id===groupId
          ? {...group,items:group.items.filter(entry=>entry.id!==item.id)}
          : group);
        await saveQuickGroups(groups);
        showToast('已从分组删除');
      }catch(err){showError(err);}
    }}
  ]);
}
function showQuickGroupContextMenu(group,anchor){
  showActionMenu(`quick-group:${group.id}`,anchor,[
    {title:'重命名分组',action:()=>openGroupEditor(group)},
    {title:'删除分组',danger:true,action:async()=>{
      const itemNote=group.items.length?`其中的 ${group.items.length} 个快捷项目也会删除，`:'该分组为空，';
      if(!confirm(`确定删除分组「${group.name}」吗？${itemNote}原收藏不会受影响。`))return;
      try{
        await saveQuickGroups(state.quickGroups.filter(entry=>entry.id!==group.id));
        showToast('已删除分组');
      }catch(err){showError(err);}
    }}
  ]);
}
function showToast(msg){
  clearTimeout(toastTimer);
  els.toast.textContent=msg;
  els.toast.classList.add('visible');
  toastTimer=setTimeout(()=>els.toast.classList.remove('visible'),TOAST_DURATION);
}

// Event wiring and startup
function openSettings(){
  renderFolderChoices();
  els.settingsDialog.showModal();
}
function bindEvents(){
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    if(!els.contextMenu.classList.contains('hidden')){
      hideContextMenu();
      return;
    }
    if(embeddedMode && !document.querySelector('dialog[open]'))closePanel().catch(showError);
  });
  document.addEventListener('dragover',handleDocumentDragOver);
  els.addButton.addEventListener('click',()=>openEditor());
  els.emptyAddButton.addEventListener('click',()=>openEditor());
  els.addQuickGroupButton.addEventListener('click',()=>openGroupEditor());
  els.favoritesToggle.addEventListener('click',()=>toggleSection('favorites').catch(showError));
  els.quickListToggle.addEventListener('click',()=>toggleSection('quickList').catch(showError));
  els.editorForm.addEventListener('submit',saveEditor);
  els.groupForm.addEventListener('submit',saveGroupEditor);
  els.kindToggle.addEventListener('click',event=>{
    const button=event.target.closest('[data-kind]');
    if(button)setEditorKind(button.dataset.kind);
  });
  els.settingsButton.addEventListener('click',openSettings);
  els.folderButton.addEventListener('click',openSettings);
  els.embeddedCloseButton.addEventListener('click',()=>closePanel().catch(showError));
  els.themeButton.addEventListener('click',()=>{
    const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';
    setTheme(theme).catch(showError);
  });
  els.appearanceOptions.addEventListener('click',event=>{
    const button=event.target.closest('[data-theme]');
    if(button)setTheme(button.dataset.theme).catch(showError);
  });
  els.manageButton.addEventListener('click',()=>{
    if(previewMode){showToast('安装扩展后即可打开 Chrome 书签管理器');return;}
    chrome.tabs.create({url:'chrome://bookmarks/'}).then(closePanel).catch(showError);
  });
  for(const button of document.querySelectorAll('[data-close]')){
    button.addEventListener('click',()=>$(button.dataset.close).close());
  }
  for(const dialog of [els.editorDialog,els.groupDialog,els.settingsDialog]){
    dialog.addEventListener('click',event=>{
      if(event.target===dialog)dialog.close();
    });
  }
  document.addEventListener('pointerdown',event=>{
    if(!event.target.closest('#contextMenu')&&!event.target.closest('.tile-more')&&!event.target.closest('.quick-group-more'))hideContextMenu();
  });
  const onScroll=()=>{
    hideContextMenu();
    scheduleScrollPositionSave();
  };
  window.addEventListener('scroll',onScroll,{passive:true});
  document.body.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('pagehide',()=>saveScrollPosition());
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden' && !panelClosing)saveScrollPosition();
  });
  window.addEventListener('resize',()=>{
    hideContextMenu();
    if(embeddedMode)applyPopupWidth(window.innerWidth);
  });
  window.addEventListener('message',event=>{
    if(!embeddedMode || event.source!==window.parent)return;
    if(event.data?.source==='safari-style-favorites-popup' && event.data.type==='request-close'){
      closePanel().catch(showError);
    }
  });
  systemThemeQuery.addEventListener('change',()=>{if(state.theme==='auto')applyTheme();});
  if(!previewMode){
    const refresh=()=>{
      if(localMutationDepth>0){
        bookmarkRefreshPending=true;
        return;
      }
      scheduleBookmarkReload();
    };
    for(const evt of [chrome.bookmarks.onCreated,chrome.bookmarks.onRemoved,chrome.bookmarks.onChanged,chrome.bookmarks.onMoved,chrome.bookmarks.onChildrenReordered]){
      evt?.addListener(refresh);
    }
    chrome.windows.onBoundsChanged?.addListener(browserWindow=>{
      if(browserWindow.id===browserWindowId)applyPopupWidth(browserWindow.width);
    });
    chrome.storage.onChanged?.addListener((changes,areaName)=>{
      const change=changes[QUICK_GROUPS_STORAGE_KEY];
      if(areaName!=='local'||!change)return;
      hasPendingStoredQuickGroups=true;
      if(quickGroupsReady)reconcilePendingQuickGroups();
    });
  }
}
async function init(){
  await syncPopupWidth();
  bindEvents();applyTheme();
  try{
    const prefs=await storageApi.get(['favoriteFolderId','lastFolderId','theme',QUICK_LIST_STORAGE_KEY,QUICK_GROUPS_STORAGE_KEY,COLLAPSE_STORAGE_KEY,SCROLL_STORAGE_KEY]);
    state.theme=['auto','light','dark'].includes(prefs.theme)?prefs.theme:'auto';
    state.rootId=prefs.favoriteFolderId||null;
    state.folderId=prefs.lastFolderId||null;
    const legacyQuickItems=normalizeQuickItems(prefs[QUICK_LIST_STORAGE_KEY]);
    state.quickGroups=normalizeQuickGroups(prefs[QUICK_GROUPS_STORAGE_KEY],legacyQuickItems);
    persistedQuickGroups=state.quickGroups;
    quickGroupsReady=true;
    state.collapsedSections=normalizeCollapsedSections(prefs[COLLAPSE_STORAGE_KEY]);
    applyTheme();
    applyCollapsedSection('favorites');
    applyCollapsedSection('quickList');
    renderQuickList();
    if(legacyQuickItems.length>0){
      storageApi.set({[QUICK_GROUPS_STORAGE_KEY]:state.quickGroups,[QUICK_LIST_STORAGE_KEY]:[]})
        .catch(err=>console.warn('迁移旧版快捷列表失败',err));
    }
    reconcilePendingQuickGroups();
    await reloadTree();
    restoreScrollPosition(prefs[SCROLL_STORAGE_KEY]);
  }catch(err){console.error(err);renderError();showToast('读取 Chrome 书签时出错');}
}
init();
