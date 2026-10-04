import { createRouter, createWebHistory } from 'vue-router'
import Overview from './views/Overview.vue'
import Station from './views/Station.vue'
import Cases from './views/Cases.vue'
import Execution from './views/Execution.vue'
import Release from './views/Release.vue'
import Reconcile from './views/Reconcile.vue'

export default createRouter({
  history:createWebHistory(),
  routes:[
    { path:'/',name:'overview',component:Overview },
    { path:'/station',name:'station',component:Station },
    { path:'/cases',name:'cases',component:Cases },
    { path:'/execution',name:'execution',component:Execution },
    { path:'/reconcile',name:'reconcile',component:Reconcile },
    { path:'/release',name:'release',component:Release },
  ],
})
