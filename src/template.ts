/*
 * The skeleton "Insert App Template" writes. It builds its view with
 * z2ui5_cl_ai_xml on purpose: that is the builder abap2UI5 is standardising
 * on, and the only one the view check can reconstruct - a template using the
 * older z2ui5_cl_xml_view handed out a class the extension's own checker then
 * ignored.
 *
 * Its own module so both entries (desktop and web) share it without the web
 * bundle dragging in the desktop plumbing.
 */
export const APP_TEMPLATE = `CLASS zcl_my_app DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
ENDCLASS.

CLASS zcl_my_app IMPLEMENTATION.
  METHOD z2ui5_if_app~main.

    DATA(view) = z2ui5_cl_ai_xml=>factory( ).
    view->open( n = \`View\` ns = \`mvc\`
        )->a( n = \`xmlns\`     v = \`sap.m\`
        )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\`
        )->open( n = \`Page\`
        )->a( n = \`title\` v = \`Hello abap2UI5\`
        )->leaf( n = \`Text\`
        )->a( n = \`text\` v = \`My first app\` ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.
ENDCLASS.
`;
