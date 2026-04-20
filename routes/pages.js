import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../firebase-admin.js';

const router = express.Router();

router.get('/', (req, res) => {
   res.render('home', { pageTitle: 'Desapega Kids' });
});

router.get('/login', (req, res) => {
   res.render('login', { layout: 'auth', pageTitle: 'Login' });
});

router.get('/register', (req, res) => {
   res.render('register', { layout: 'auth', pageTitle: 'register' });
});

router.get("/perfil", (req, res) => {
  res.render("perfil", { 
    pageTitle: "Meu Perfil", 
    user: req.session.user 
  });
});
// Página de doar
router.get('/doar', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    res.render('doar', { 
        pageTitle: 'Doar Item - Desapega Kids',
        user: req.session.user 
    });
});

// Página meus itens
router.get('/meus-itens', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    res.render('meus-itens', { 
        pageTitle: 'Meus Itens - Desapega Kids',
        user: req.session.user 
    });
});

// Página de busca
router.get('/buscar', (req, res) => {
    res.render('buscar', { 
        pageTitle: 'Buscar Itens - Desapega Kids',
        user: req.session.user 
    });
});

// Detalhes do item
router.get('/item/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log('Buscando item:', id); // Debug
        
        const itemDoc = await db.collection('itens').doc(id).get();
        
        if (!itemDoc.exists) {
            console.log('Item não encontrado:', id); // Debug
            return res.status(404).render('404', { 
                pageTitle: 'Item não encontrado',
                user: req.session.user
            });
        }
        
        const item = { id: itemDoc.id, ...itemDoc.data() };
        
        console.log('Item encontrado:', item.nome); // Debug
        
        res.render('item-detalhes', { 
            pageTitle: item.nome + ' - Desapega Kids',
            user: req.session.user,
            item
        });
    } catch (error) {
        console.error('Erro ao carregar item:', error);
        res.status(500).render('erro', { 
            pageTitle: 'Erro',
            user: req.session.user,
            mensagem: 'Erro ao carregar item: ' + error.message
        });
    }
});

// Editar item
router.get('/editar-item/:id', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    
    try {
        const { id } = req.params;
        
        console.log('Editando item:', id); // Debug
        
        const itemDoc = await db.collection('itens').doc(id).get();
        
        if (!itemDoc.exists) {
            return res.status(404).render('404', { 
                pageTitle: 'Item não encontrado',
                user: req.session.user
            });
        }
        
        const item = { id: itemDoc.id, ...itemDoc.data() };
        
        // Verificar se o usuário é o dono do item
        if (item.doadorId !== req.session.user.uid) {
            return res.status(403).render('erro', { 
                pageTitle: 'Acesso negado',
                user: req.session.user,
                mensagem: 'Você não tem permissão para editar este item' 
            });
        }
        
        res.render('editar-item', { 
            pageTitle: 'Editar ' + item.nome + ' - Desapega Kids',
            user: req.session.user,
            item
        });
    } catch (error) {
        console.error('Erro ao carregar item para edição:', error);
        res.status(500).render('erro', { 
            pageTitle: 'Erro',
            user: req.session.user,
            mensagem: 'Erro ao carregar item: ' + error.message
        });
    }
});

export default router;