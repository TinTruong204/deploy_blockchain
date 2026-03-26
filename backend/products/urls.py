from django.urls import path
from . import views

urlpatterns = [
    path('create/', views.create_product),
    path('update/', views.update_product),
    path('product/<str:id>/', views.get_product),
    path('products/', views.get_products_by_wallet),
]